import { createHmac, timingSafeEqual } from "node:crypto";
import { appEnv, paymentAssetById } from "@zetra/config";
import { withSystem, withTenant, type Client } from "@zetra/database";
import { newId, type Environment } from "@zetra/schemas";
import { decryptSecret } from "@zetra/security";
import { audit, EngineError, SYSTEM, type Actor } from "./context";
import { recomputeInvoice } from "./pipeline";
import { accountSafely } from "./accounting/posting-rules";
import { postEntry, type LineInput } from "./accounting/ledger";
import { systemAccount, valueInReporting } from "./accounting/chart";

type Row = Record<string, any>;

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/** Verify Stripe's `t=...,v1=...` signature without accepting a replay older than five minutes. */
export function verifyStripeSignature(rawBody: string, signature: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!signature || !secret) return false;
  const parts = signature.split(",").map((part) => part.split("=", 2) as [string, string]);
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value).filter(Boolean);
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300 || !signatures.length) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return signatures.some((candidate) => {
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(candidate, "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

function recordForEvent(event: any): { object: any; status: "succeeded" | "refunded" | "disputed" | "failed" | "ignored" } {
  const type = String(event?.type ?? "");
  const object = event?.data?.object ?? {};
  if (type === "payment_intent.succeeded" || (type === "checkout.session.completed" && object.payment_status === "paid")) return { object, status: "succeeded" };
  if (type === "charge.refunded" || type === "payment_intent.payment_failed") return { object, status: type === "charge.refunded" ? "refunded" : "failed" };
  if (type === "charge.dispute.created") return { object, status: "disputed" };
  return { object, status: "ignored" };
}

function metadata(object: any): Record<string, string> {
  const m = object?.metadata;
  if (!m || typeof m !== "object") return {};
  return Object.fromEntries(Object.entries(m).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** Checkout sessions and PaymentIntents describe the same economic event. Canonicalize both to
 * the PaymentIntent id so Stripe's two webhook types cannot create two receipts. */
function stripeObjectId(object: any, fallback: string): string {
  const paymentIntent = object?.payment_intent;
  if (typeof paymentIntent === "string" && paymentIntent) return paymentIntent;
  if (paymentIntent && typeof paymentIntent.id === "string" && paymentIntent.id) return paymentIntent.id;
  return String(object?.id ?? fallback);
}

function stripeAmountToAssetUnits(cents: unknown, assetId: string): bigint {
  const raw = typeof cents === "number" ? String(cents) : typeof cents === "string" ? cents : "";
  if (!/^\d+$/.test(raw)) throw new EngineError("stripe_amount_invalid", "Stripe did not provide an integer cent amount.", 422);
  const asset = paymentAssetById(assetId)?.asset;
  if (!asset || asset.pegCurrency !== "USD") throw new EngineError("stripe_asset_invalid", "Stripe receipts require a USD-pegged configured asset.", 422);
  // Stripe reports USD cents; Zetra's USDC ledger uses six decimal base units.
  if (asset.decimals < 2) throw new EngineError("stripe_asset_precision", "The configured asset cannot represent Stripe cents.", 422);
  return BigInt(raw) * 10n ** BigInt(asset.decimals - 2);
}

async function stripeSecret(source: Row): Promise<string | undefined> {
  const configured = appEnv().STRIPE_WEBHOOK_SECRET?.trim();
  if (configured) return configured;
  try {
    return decryptSecret(source.secret_ciphertext, appEnv().encryptionKey);
  } catch {
    return undefined;
  }
}

export async function receiveStripeWebhook(sourceId: string, headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<{ status: number; outcome: string; event_id?: string; receipt_id?: string | null; detail?: string; duplicate?: boolean }> {
  const source = (await withSystem((c) => c.query("SELECT * FROM payment_sources WHERE id = $1", [sourceId]))).rows[0] as Row | undefined;
  if (!source) return { status: 404, outcome: "rejected", detail: "No such payment source." };
  if (source.status !== "active" || source.kind !== "processor" || source.provider.toLowerCase() !== "stripe") return { status: 410, outcome: "rejected", detail: "This source is not an active Stripe connection." };
  const secret = await stripeSecret(source);
  if (!secret || !verifyStripeSignature(rawBody, header(headers, "stripe-signature"), secret)) return { status: 401, outcome: "rejected", detail: "The Stripe signature is invalid or expired." };
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 422, outcome: "rejected", detail: "The body is not valid JSON." };
  }
  if (typeof event?.id !== "string" || !event.id.startsWith("evt_")) return { status: 422, outcome: "rejected", detail: "Stripe event id is missing." };
  return withTenant(source.organization_id, (client) => processStripeEvent(client, source, event));
}

async function processStripeEvent(client: Client, source: Row, event: any): Promise<{ status: number; outcome: string; event_id: string; receipt_id: string | null; detail?: string; duplicate?: boolean }> {
  const existing = (await client.query("SELECT id, status, processing_error FROM payment_source_events WHERE source_id = $1 AND canonical_key = $2", [source.id, `stripe:${event.id}`])).rows[0] as Row | undefined;
  if (existing) return { status: 200, outcome: existing.status, event_id: existing.id, receipt_id: null, detail: existing.processing_error ?? undefined, duplicate: true };
  const sourceEventId = newId("paymentSourceEvent");
  await client.query(
    `INSERT INTO payment_source_events (id, organization_id, environment, source_id, canonical_key, provider_event_id, payload, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'received')`,
    [sourceEventId, source.organization_id, source.environment, source.id, `stripe:${event.id}`, event.id, JSON.stringify(event)]
  );
  const parsed = recordForEvent(event);
  if (parsed.status === "ignored") {
    await client.query("UPDATE payment_source_events SET status = 'ignored', processed_at = now(), updated_at = now() WHERE id = $1", [sourceEventId]);
    return { status: 200, outcome: "ignored", event_id: sourceEventId, receipt_id: null, detail: `Stripe event ${event.type} is retained but has no accounting effect.` };
  }
  try {
    const object = parsed.object;
    if (parsed.status !== "succeeded") {
      const objectIds = [object?.id, object?.payment_intent, object?.payment_intent?.id, event.id].filter((value): value is string => typeof value === "string" && value.length > 0);
      const previous = (await client.query("SELECT id FROM processor_receipts WHERE source_id = $1 AND provider_object_id = ANY($2) ORDER BY received_at DESC LIMIT 1", [source.id, objectIds])).rows[0] as Row | undefined;
      if (previous) await client.query("UPDATE processor_receipts SET status = $1, processed_at = now() WHERE id = $2", [parsed.status, previous.id]);
      await client.query("UPDATE payment_source_events SET status = 'processed', processed_at = now(), updated_at = now() WHERE id = $1", [sourceEventId]);
      return { status: 200, outcome: "processed", event_id: sourceEventId, receipt_id: previous?.id ?? null, detail: previous ? `Stripe receipt marked ${parsed.status}.` : "Stripe lifecycle event retained; no prior receipt was found." };
    }
    const meta = metadata(object);
    const invoice = meta.zetra_invoice_id
      ? (await client.query("SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [meta.zetra_invoice_id, source.organization_id, source.environment])).rows[0] as Row | undefined
      : meta.zetra_public_token
        ? (await client.query("SELECT * FROM invoices WHERE public_token = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [meta.zetra_public_token, source.organization_id, source.environment])).rows[0] as Row | undefined
        : undefined;
    if (parsed.status === "succeeded" && !invoice) throw new EngineError("stripe_invoice_missing", "Stripe event is missing a valid Zetra invoice metadata reference.", 422);
    if (parsed.status === "succeeded" && String(object.currency ?? "usd").toLowerCase() !== "usd") throw new EngineError("stripe_currency_unsupported", "Only USD Stripe receipts are supported by the current NEAR/USDC books.", 422);
    const amount = invoice ? stripeAmountToAssetUnits(object.amount_received ?? object.amount_total ?? object.amount, invoice.asset_id) : 1n;
    const occurred = event.created ? new Date(Number(event.created) * 1000) : new Date();
    const providerObjectId = stripeObjectId(object, event.id);
    const inserted = await client.query(
      `INSERT INTO processor_receipts (id, organization_id, environment, source_id, provider, provider_event_id, provider_object_id, status, currency, amount, asset_id, invoice_id, customer_id, payer_email, description, raw, occurred_at, processed_at)
       VALUES ($1,$2,$3,$4,'stripe',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        newId("processorReceipt"), source.organization_id, source.environment, source.id, event.id, providerObjectId, parsed.status,
        String(object.currency ?? "usd").toUpperCase(), amount.toString(), invoice?.asset_id ?? null, invoice?.id ?? null, invoice?.customer_id ?? null,
        object.receipt_email ?? object.customer_details?.email ?? null, object.description ?? null, JSON.stringify(event), occurred
      ]
    );
    const receiptId = inserted.rows[0]?.id as string | undefined;
    if (!receiptId) throw new EngineError("stripe_duplicate", "This Stripe receipt was already recorded.", 200);
    if (invoice && parsed.status === "succeeded") {
      await client.query(
        `INSERT INTO processor_receipt_allocations (id, organization_id, environment, receipt_id, invoice_id, amount, kind)
         VALUES ($1,$2,$3,$4,$5,$6,'automatic')`,
        [newId("processorReceiptAllocation"), source.organization_id, source.environment, receiptId, invoice.id, amount.toString()]
      );
      await recomputeInvoice(client, invoice.id, occurred);
    }
    await accountSafely(client, { organizationId: source.organization_id, environment: source.environment, sourceKey: `processor-receipt:${receiptId}`, sourceType: "processor_receipt", sourceId: receiptId }, async (settings) => {
      await postProcessorReceipt(client, settings, receiptId);
      const allocation = (await client.query("SELECT * FROM processor_receipt_allocations WHERE receipt_id = $1 ORDER BY id LIMIT 1", [receiptId])).rows[0] as Row | undefined;
      if (allocation) await postProcessorApplication(client, settings, receiptId, allocation);
    });
    await client.query("UPDATE payment_source_events SET status = 'processed', processed_at = now(), updated_at = now() WHERE id = $1", [sourceEventId]);
    await client.query("UPDATE payment_sources SET last_event_at = now(), last_error = NULL, updated_at = now() WHERE id = $1", [source.id]);
    return { status: 200, outcome: "processed", event_id: sourceEventId, receipt_id: receiptId, detail: "Stripe receipt recorded and reconciled into the books." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof EngineError && error.code === "stripe_duplicate") {
      await client.query("UPDATE payment_source_events SET status = 'processed', processed_at = now(), updated_at = now() WHERE id = $1", [sourceEventId]);
      return { status: 200, outcome: "processed", event_id: sourceEventId, receipt_id: null, detail, duplicate: true };
    }
    await client.query("UPDATE payment_source_events SET status = 'failed', processing_error = $2, processed_at = now(), updated_at = now() WHERE id = $1", [sourceEventId, detail.slice(0, 500)]);
    await client.query("UPDATE payment_sources SET last_error = $2, updated_at = now() WHERE id = $1", [source.id, detail.slice(0, 500)]);
    return { status: 200, outcome: "failed", event_id: sourceEventId, receipt_id: null, detail };
  }
}

export async function postProcessorReceipt(client: Client, settings: { reportingCurrency: string }, receiptId: string): Promise<void> {
  const r = (await client.query("SELECT * FROM processor_receipts WHERE id = $1", [receiptId])).rows[0] as Row;
  if (!r.asset_id) throw new EngineError("processor_asset_missing", "Processor receipt has no accounting asset.", 422);
  const { amount, rateSource } = valueInReporting(r.asset_id, BigInt(r.amount), settings.reportingCurrency);
  const bank = await systemAccount(client, r.organization_id, r.environment, "bank");
  const suspense = await systemAccount(client, r.organization_id, r.environment, "payments_to_identify");
  const refs: Partial<LineInput> = { processorReceiptId: r.id, assetId: r.asset_id, assetAmount: BigInt(r.amount), rateSource };
  await postEntry(client, {
    organizationId: r.organization_id,
    environment: r.environment,
    date: new Date(r.occurred_at),
    description: `Stripe receipt ${r.provider_object_id ?? r.provider_event_id}`,
    memo: "Processor clearing receipt; held in Payments to Identify until allocated.",
    sourceType: "processor_receipt",
    sourceId: r.id,
    sourceKey: `processor-receipt:${r.id}`,
    actor: SYSTEM,
    lines: [{ ...refs, accountId: bank.id, debit: amount, memo: "Stripe clearing" }, { ...refs, accountId: suspense.id, credit: amount, memo: "Processor receipt pending application" }]
  });
}

export async function postProcessorApplication(client: Client, settings: { reportingCurrency: string; method?: "accrual" | "cash" }, receiptId: string, allocation: Row): Promise<void> {
  const r = (await client.query("SELECT * FROM processor_receipts WHERE id = $1", [receiptId])).rows[0] as Row;
  const inv = (await client.query("SELECT * FROM invoices WHERE id = $1", [allocation.invoice_id])).rows[0] as Row;
  const amount = BigInt(allocation.amount);
  const beforeRow = (await client.query<{ total: string }>(
    `SELECT (COALESCE((SELECT SUM(amount) FROM allocations WHERE invoice_id = $1 AND kind <> 'reversal'),0)
       + COALESCE((SELECT SUM(amount) FROM processor_receipt_allocations WHERE invoice_id = $1 AND id <> $2),0)
       + COALESCE((SELECT SUM(amount) FROM credit_applications WHERE to_invoice_id = $1),0)
       - COALESCE((SELECT SUM(amount) FROM credit_applications WHERE from_invoice_id = $1),0))::text AS total`,
    [inv.id, allocation.id]
  )).rows[0]!;
  const before = BigInt(beforeRow.total);
  const capacity = BigInt(inv.amount_due) - BigInt(inv.amount_written_off ?? 0);
  const owed = capacity > before ? capacity - before : 0n;
  const toReceivable = amount < owed ? amount : owed;
  const excess = amount - toReceivable;
  const value = valueInReporting(r.asset_id, amount, settings.reportingCurrency);
  const receivableValue = valueInReporting(r.asset_id, toReceivable, settings.reportingCurrency);
  const suspense = await systemAccount(client, r.organization_id, r.environment, "payments_to_identify");
  const target = settings.method === "cash" ? await systemAccount(client, r.organization_id, r.environment, "sales") : await systemAccount(client, r.organization_id, r.environment, "accounts_receivable");
  const refs: Partial<LineInput> = { processorReceiptId: receiptId, invoiceId: inv.id, customerId: inv.customer_id, assetId: r.asset_id, assetAmount: amount, rateSource: value.rateSource };
  const credits = excess > 0n ? await systemAccount(client, r.organization_id, r.environment, "customer_credits") : null;
  const lines: LineInput[] = [
    { ...refs, accountId: suspense.id, debit: value.amount, memo: "Stripe receipt applied" },
    ...(toReceivable > 0n ? [{ ...refs, accountId: target.id, credit: receivableValue.amount, assetAmount: toReceivable, memo: `Settles ${inv.number}` }] : []),
    ...(credits ? [{ ...refs, accountId: credits.id, credit: value.amount - receivableValue.amount, assetAmount: excess, memo: "Overpayment retained as customer credit" }] : [])
  ];
  await postEntry(client, {
    organizationId: r.organization_id,
    environment: r.environment,
    date: new Date(r.occurred_at),
    description: `Stripe receipt applied to ${inv.number}`,
    sourceType: "processor_application",
    sourceId: allocation.id,
    sourceKey: `processor-apply:${allocation.id}`,
    actor: SYSTEM,
    lines
  });
}

/** Creates a hosted Stripe Checkout session for a Zetra invoice. */
export async function createStripeCheckout(client: Client, organizationId: string, environment: Environment, invoiceId: string, actor: Actor): Promise<{ id: string; url: string }> {
  const secret = appEnv().STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new EngineError("stripe_not_configured", "STRIPE_SECRET_KEY is not configured on this deployment.", 422);
  const invoice = (await client.query("SELECT i.*, c.email AS customer_email FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1 AND i.organization_id = $2 AND i.environment = $3", [invoiceId, organizationId, environment])).rows[0] as Row | undefined;
  if (!invoice) throw new EngineError("not_found", "No such invoice.", 404);
  if (!["open", "partially_paid"].includes(invoice.status)) throw new EngineError("invoice_not_payable", "Only open invoices can be paid through Stripe.", 409);
  const configuredAsset = paymentAssetById(invoice.asset_id)?.asset;
  if (!configuredAsset || configuredAsset.pegCurrency !== "USD" || configuredAsset.decimals < 2) {
    throw new EngineError("stripe_asset_invalid", "Stripe Checkout requires a configured USD-pegged invoice asset.", 422);
  }
  const remaining = BigInt(invoice.amount_due) - BigInt(invoice.amount_paid ?? 0) - BigInt(invoice.amount_written_off ?? 0);
  const cents = remaining / 10_000n;
  if (cents <= 0n || remaining % 10_000n !== 0n) throw new EngineError("stripe_precision", "This invoice cannot be represented exactly in Stripe cents.", 422);
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", `${appEnv().publicAppUrl.replace(/\/$/, "")}/pay/${invoice.public_token}?stripe=success`);
  body.set("cancel_url", `${appEnv().publicAppUrl.replace(/\/$/, "")}/pay/${invoice.public_token}?stripe=cancelled`);
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "usd");
  body.set("line_items[0][price_data][unit_amount]", cents.toString());
  body.set("line_items[0][price_data][product_data][name]", String(invoice.title).slice(0, 200));
  body.set("metadata[zetra_invoice_id]", invoice.id);
  body.set("metadata[zetra_public_token]", invoice.public_token);
  body.set("metadata[zetra_organization_id]", organizationId);
  body.set("payment_intent_data[metadata][zetra_invoice_id]", invoice.id);
  body.set("payment_intent_data[metadata][zetra_public_token]", invoice.public_token);
  body.set("payment_intent_data[metadata][zetra_organization_id]", organizationId);
  if (invoice.customer_email) body.set("customer_email", invoice.customer_email);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" }, body });
  const payload = (await response.json()) as any;
  if (!response.ok || typeof payload.id !== "string" || typeof payload.url !== "string") throw new EngineError("stripe_checkout_failed", payload?.error?.message ?? "Stripe could not create a checkout session.", 502);
  await audit(client, actor, { organizationId, environment, action: "stripe_checkout_created", objectType: "invoice", objectId: invoice.id, next: { checkout_id: payload.id } });
  return { id: payload.id, url: payload.url };
}

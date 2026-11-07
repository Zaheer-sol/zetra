import { appEnv, paymentAssetById, paymentNetworkById } from "@zetra/config";
import { withSystem, type Client } from "@zetra/database";
import { sendFt, payoutSignerFor } from "@zetra/blockchain";
import { newId, toBaseUnits, type Environment } from "@zetra/schemas";
import { accountSafely } from "./accounting/posting-rules";
import { nativeAccount, systemAccount, valueInReporting, type BooksSettings, walletAccount } from "./accounting/chart";
import { postEntry, type LineInput } from "./accounting/ledger";
import { audit, EngineError, log, SYSTEM, type Actor } from "./context";

type Row = Record<string, any>;

const ACTIVE_REFUND_STATUSES = ["pending_approval", "approved", "submitting", "submitted"];

function assetFor(networkId: string, symbol: string) {
  const network = paymentNetworkById(networkId);
  const asset = network?.assets.find((candidate) => candidate.symbol === symbol.toUpperCase());
  if (!asset) throw new EngineError("asset_unknown", `The ${symbol} asset is not enabled on ${networkId}.`, 422);
  return asset;
}

export async function createPayoutRequest(client: Client, organizationId: string, environment: Environment, input: {
  kind: "payment" | "refund" | "vendor";
  walletId: string;
  recipient: string;
  amount: string;
  asset: string;
  memo?: string;
  paymentId?: string;
  invoiceId?: string;
  vendorId?: string;
  idempotencyKey: string;
}, actor: Actor): Promise<Row> {
  const duplicate = (await client.query("SELECT * FROM payout_requests WHERE organization_id = $1 AND environment = $2 AND idempotency_key = $3", [organizationId, environment, input.idempotencyKey])).rows[0] as Row | undefined;
  if (duplicate) return duplicate;
  const wallet = (await client.query("SELECT * FROM wallets WHERE id = $1 AND organization_id = $2 AND environment = $3 AND archived_at IS NULL", [input.walletId, organizationId, environment])).rows[0] as Row | undefined;
  if (!wallet) throw new EngineError("wallet_not_found", "Choose an active wallet in this workspace.", 404);
  if (!wallet.network_id.startsWith("near:")) throw new EngineError("near_only", "Outgoing transfers currently support NEAR only.", 422);
  const asset = assetFor(wallet.network_id, input.asset);
  const assetRow = (await client.query("SELECT id FROM assets WHERE id = $1 AND network_id = $2 AND enabled = true", [asset.id, wallet.network_id])).rows[0];
  if (!assetRow) throw new EngineError("asset_not_configured", "This wallet asset is not configured.", 422);
  const enabled = (await client.query("SELECT 1 FROM wallet_assets WHERE wallet_id = $1 AND asset_id = $2", [wallet.id, asset.id])).rows[0];
  if (!enabled) throw new EngineError("asset_not_enabled", "Enable this asset on the payout wallet first.", 422);
  const amount = toBaseUnits(input.amount, asset.decimals);
  if (amount <= 0n) throw new EngineError("amount_invalid", "Payout amount must be positive.", 422);
  const recipient = input.recipient.toLowerCase();
  if (recipient === wallet.address.toLowerCase()) throw new EngineError("recipient_invalid", "A payout recipient must differ from the sending wallet.", 422);
  if (input.paymentId) {
    const p = (await client.query("SELECT * FROM payments WHERE id = $1 AND organization_id = $2 AND environment = $3", [input.paymentId, organizationId, environment])).rows[0] as Row | undefined;
    if (!p) throw new EngineError("payment_not_found", "No such payment.", 404);
    if (p.wallet_id !== wallet.id || p.asset_id !== asset.id) throw new EngineError("payout_mismatch", "The payout does not match the payment wallet and asset.", 422);
  }
  if (input.kind === "refund" && !input.paymentId) throw new EngineError("refund_payment_required", "Refunds must reference the payment they reverse.", 422);
  if (input.invoiceId) {
    const invoice = (await client.query("SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 AND environment = $3", [input.invoiceId, organizationId, environment])).rows[0];
    if (!invoice) throw new EngineError("invoice_not_found", "The payout invoice does not belong to this workspace.", 404);
  }
  if (input.vendorId) {
    const vendor = (await client.query("SELECT id FROM vendors WHERE id = $1 AND organization_id = $2 AND environment = $3", [input.vendorId, organizationId, environment])).rows[0];
    if (!vendor) throw new EngineError("vendor_not_found", "The payout vendor does not belong to this workspace.", 404);
  }
  const id = newId(input.kind === "refund" ? "refund" : "outgoingTransfer");
  await client.query(
    `INSERT INTO payout_requests (id, organization_id, environment, kind, wallet_id, network_id, asset_id, token_address, recipient, amount, memo, payment_id, invoice_id, vendor_id, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, organizationId, environment, input.kind, wallet.id, wallet.network_id, asset.id, asset.contractId, recipient, amount.toString(), input.memo ?? null, input.paymentId ?? null, input.invoiceId ?? null, input.vendorId ?? null, input.idempotencyKey, actor.id ?? null]
  );
  await audit(client, actor, { organizationId, environment, action: "payout_requested", objectType: "payout", objectId: id, next: { kind: input.kind, wallet_id: wallet.id, recipient, amount: amount.toString(), asset_id: asset.id } });
  return (await client.query("SELECT * FROM payout_requests WHERE id = $1", [id])).rows[0] as Row;
}

export async function createRefundRequest(client: Client, organizationId: string, environment: Environment, paymentId: string, input: { amount?: string; memo?: string; idempotencyKey: string }, actor: Actor): Promise<Row> {
  const duplicate = (await client.query("SELECT * FROM payout_requests WHERE organization_id = $1 AND environment = $2 AND idempotency_key = $3", [organizationId, environment, input.idempotencyKey])).rows[0] as Row | undefined;
  if (duplicate) return duplicate;
  const payment = (await client.query("SELECT * FROM payments WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [paymentId, organizationId, environment])).rows[0] as Row | undefined;
  if (!payment) throw new EngineError("payment_not_found", "No such payment.", 404);
  if (!["matched", "partial", "overpaid", "needs_review", "dismissed"].includes(payment.status)) throw new EngineError("payment_not_refundable", "Only a finalized payment can be refunded.", 409);
  const asset = payment.asset_id ? paymentAssetById(payment.asset_id)?.asset : undefined;
  if (!asset) throw new EngineError("asset_unknown", "This payment has no supported accounting asset.", 422);
  const amount = input.amount ?? (await import("@zetra/schemas")).fromBaseUnits(BigInt(payment.amount), asset.decimals);
  const requested = toBaseUnits(amount, asset.decimals);
  const alreadyRefunded = (await client.query(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM payout_requests
      WHERE payment_id = $1 AND kind = 'refund' AND status = ANY($2)`,
    [payment.id, [...ACTIVE_REFUND_STATUSES, "confirmed"]]
  )).rows[0] as Row;
  if (requested + BigInt(alreadyRefunded.total ?? 0) > BigInt(payment.amount)) throw new EngineError("refund_too_large", "Cumulative refunds cannot exceed the original payment.", 422);
  return createPayoutRequest(client, organizationId, environment, {
    kind: "refund",
    walletId: payment.wallet_id,
    recipient: payment.from_address,
    amount,
    asset: asset.symbol,
    memo: input.memo ?? `Refund for ${payment.transaction_hash}`,
    paymentId: payment.id,
    invoiceId: payment.invoice_id ?? undefined,
    idempotencyKey: input.idempotencyKey
  }, actor);
}

export async function approvePayout(client: Client, organizationId: string, environment: Environment, payoutId: string, actor: Actor): Promise<Row> {
  const before = (await client.query("SELECT * FROM payout_requests WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [payoutId, organizationId, environment])).rows[0] as Row | undefined;
  if (!before) throw new EngineError("not_found", "No such payout.", 404);
  if (!["pending_approval", "failed"].includes(before.status)) throw new EngineError("payout_not_approvable", `This payout is ${before.status}.`, 409);
  await client.query("UPDATE payout_requests SET status = 'approved', approved_by = $2, approved_at = now(), error = NULL, updated_at = now() WHERE id = $1", [payoutId, actor.id ?? null]);
  await audit(client, actor, { organizationId, environment, action: "payout_approved", objectType: "payout", objectId: payoutId, previous: { status: before.status }, next: { status: "approved" } });
  return (await client.query("SELECT * FROM payout_requests WHERE id = $1", [payoutId])).rows[0] as Row;
}

export async function cancelPayout(client: Client, organizationId: string, environment: Environment, payoutId: string, reason: string | undefined, actor: Actor): Promise<Row> {
  const before = (await client.query("SELECT * FROM payout_requests WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [payoutId, organizationId, environment])).rows[0] as Row | undefined;
  if (!before) throw new EngineError("not_found", "No such payout.", 404);
  if (!["pending_approval", "approved", "failed"].includes(before.status)) throw new EngineError("payout_not_cancellable", `A ${before.status} payout cannot be cancelled.`, 409);
  await client.query("UPDATE payout_requests SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), error = $3, updated_at = now() WHERE id = $1", [payoutId, actor.id ?? null, reason ?? null]);
  await audit(client, actor, { organizationId, environment, action: "payout_cancelled", objectType: "payout", objectId: payoutId, previous: { status: before.status }, next: { status: "cancelled", reason: reason ?? null } });
  return (await client.query("SELECT * FROM payout_requests WHERE id = $1", [payoutId])).rows[0] as Row;
}

async function claimPayout(): Promise<Row | undefined> {
  return withSystem(async (client) => {
    // Never automatically requeue an interrupted submission: the NEAR transaction may have
    // reached finality even if the worker crashed before persisting its hash, and a second
    // submission could pay the recipient twice. An operator must inspect chain evidence and
    // explicitly resolve an uncertain request before retrying it.
    const row = (await client.query("SELECT * FROM payout_requests WHERE status = 'approved' ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0] as Row | undefined;
    if (!row) return undefined;
    await client.query("UPDATE payout_requests SET status = 'submitting', updated_at = now() WHERE id = $1", [row.id]);
    return { ...row, status: "submitting" };
  });
}

function parseRate(raw: string): { numerator: bigint; denominator: bigint } {
  const [whole, fraction = ""] = raw.split(".");
  const digits = `${whole}${fraction}`;
  return { numerator: BigInt(digits), denominator: 10n ** BigInt(fraction.length) };
}

async function gasAccounting(client: Client, payout: Row, attempt: Row, fee: bigint): Promise<void> {
  const date = new Date(attempt.created_at);
  const rateRow = (await client.query("SELECT rate::text AS rate, source FROM fx_rates WHERE (organization_id = $1 OR organization_id IS NULL) AND base = 'NEAR' AND quote = 'USD' AND rate_date <= $2::date ORDER BY (organization_id IS NULL), rate_date DESC LIMIT 1", [payout.organization_id, date])).rows[0] as Row | undefined;
  const fallback = appEnv().NEAR_FEE_USD_RATE;
  const rate = rateRow?.rate ?? fallback;
  let reportingMicros: bigint | null = null;
  let rateSource: string | null = null;
  if (rate) {
    const parsed = parseRate(String(rate));
    const numerator = fee * parsed.numerator * 1_000_000n;
    const denominator = 10n ** 24n * parsed.denominator;
    reportingMicros = (numerator + denominator / 2n) / denominator;
    rateSource = rateRow ? `fx:${rateRow.source ?? "configured"}` : "env:NEAR_FEE_USD_RATE";
  }
  await client.query(
    `INSERT INTO network_fee_records (id, organization_id, environment, payout_attempt_id, wallet_id, network_id, fee_yoctonear, fee_reporting_micros, rate_source, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (payout_attempt_id) DO NOTHING`,
    [newId("networkFee"), payout.organization_id, payout.environment, attempt.id, payout.wallet_id, payout.network_id, fee.toString(), reportingMicros?.toString() ?? null, rateSource, reportingMicros === null ? "unvalued" : "valued"]
  );
  if (reportingMicros === null || reportingMicros === 0n) {
    if (reportingMicros === null) {
      await client.query(
        `INSERT INTO accounting_issues (id, organization_id, environment, source_key, source_type, source_id, message)
         VALUES ($1,$2,$3,$4,'network_fee',$5,'NEAR fee recorded in yoctoNEAR but no NEAR/USD valuation was available.')
         ON CONFLICT (organization_id,environment,source_key) DO UPDATE SET resolved_at = NULL, updated_at = now()`,
        [newId("accountingIssue"), payout.organization_id, payout.environment, `network-fee:${attempt.id}`, attempt.id]
      );
    }
    return;
  }
  await accountSafely(client, { organizationId: payout.organization_id, environment: payout.environment, sourceKey: `network-fee:${attempt.id}`, sourceType: "network_fee", sourceId: attempt.id }, async (settings) => {
    const expense = await systemAccount(client, payout.organization_id, payout.environment, "network_fees");
    const native = await nativeAccount(client, payout.organization_id, payout.environment, payout.wallet_id, "NEAR");
    await postEntry(client, {
      organizationId: payout.organization_id,
      environment: payout.environment,
      date,
      description: `NEAR gas fee for ${payout.id}`,
      memo: "Final network fee from the NEAR execution outcome.",
      sourceType: "network_fee",
      sourceId: attempt.id,
      sourceKey: `network-fee:${attempt.id}`,
      actor: SYSTEM,
      lines: [
        { accountId: expense.id, debit: reportingMicros, payoutAttemptId: attempt.id, assetAmount: fee, rateSource: rateSource ?? settings.reportingCurrency },
        { accountId: native.id, credit: reportingMicros, payoutAttemptId: attempt.id, assetAmount: fee, rateSource: rateSource ?? settings.reportingCurrency }
      ]
    });
  });
}

async function payoutAccounting(client: Client, payout: Row, attempt: Row): Promise<void> {
  if (payout.kind !== "refund") return;
  await accountSafely(client, { organizationId: payout.organization_id, environment: payout.environment, sourceKey: `refund:${payout.id}`, sourceType: "refund", sourceId: payout.id }, async (settings: BooksSettings) => {
    const asset = paymentAssetById(payout.asset_id)?.asset;
    if (!asset) throw new EngineError("asset_unknown", "Refund asset has no valuation.", 422);
    const { amount, rateSource } = valueInReporting(payout.asset_id, BigInt(payout.amount), settings.reportingCurrency);
    const wallet = await walletAccount(client, payout.organization_id, payout.environment, payout.wallet_id, payout.asset_id);
    // A refund of an invoiced sale is a contra-revenue entry; an unassigned/overpayment refund
    // consumes the customer-credit liability instead of inventing revenue.
    const debit = payout.invoice_id
      ? await systemAccount(client, payout.organization_id, payout.environment, "sales")
      : await systemAccount(client, payout.organization_id, payout.environment, "customer_credits");
    const refs: Partial<LineInput> = { payoutAttemptId: attempt.id, assetId: payout.asset_id, assetAmount: BigInt(payout.amount), rateSource };
    await postEntry(client, { organizationId: payout.organization_id, environment: payout.environment, date: new Date(attempt.created_at), description: `Refund ${payout.id}`, memo: "Confirmed outgoing NEAR refund.", sourceType: "refund", sourceId: payout.id, sourceKey: `refund:${payout.id}`, actor: SYSTEM, lines: [{ ...refs, accountId: debit.id, debit: amount, memo: "Customer refund" }, { ...refs, accountId: wallet.id, credit: amount, memo: "NEAR asset sent" }] });
  });
}

async function processOne(payout: Row): Promise<void> {
  const signer = payoutSignerFor(payout.network_id);
  if (!signer) {
    await withSystem(async (client) => {
      await client.query("UPDATE payout_requests SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = 'submitting'", [payout.id, "No payout signer is configured for this NEAR network."]);
    });
    return;
  }
  try {
    const wallet = (await withSystem((client) => client.query("SELECT address FROM wallets WHERE id = $1", [payout.wallet_id]))).rows[0] as Row | undefined;
    if (!wallet || wallet.address.toLowerCase() !== signer.signerId.toLowerCase()) throw new Error("The configured NEAR payout signer does not match the payout wallet.");
    const transfer = await sendFt({ networkId: payout.network_id, signerId: signer.signerId, privateKey: signer.privateKey, tokenContract: payout.token_address, receiverId: payout.recipient, amount: BigInt(payout.amount), memo: payout.memo ?? undefined });
    await withSystem(async (client) => {
      const attempt = (await client.query("INSERT INTO payout_attempts (id, organization_id, environment, payout_id, attempt_number, status, tx_hash, block_hash, gas_burnt, tokens_burnt, fee_yoctonear, raw) SELECT $1,$2,$3,$4,COALESCE((SELECT max(attempt_number)+1 FROM payout_attempts WHERE payout_id=$4),1),'confirmed',$5,$6,$7,$8,$9,$10 RETURNING *", [newId("payoutAttempt"), payout.organization_id, payout.environment, payout.id, transfer.txHash, transfer.blockHash, transfer.gasBurnt?.toString() ?? null, transfer.tokensBurnt?.toString() ?? null, transfer.feeYoctonear?.toString() ?? null, JSON.stringify(transfer.raw)])).rows[0] as Row;
      await client.query("UPDATE payout_requests SET status = 'confirmed', tx_hash = $2, block_hash = $3, submitted_at = COALESCE(submitted_at, now()), confirmed_at = now(), updated_at = now(), error = NULL WHERE id = $1", [payout.id, transfer.txHash, transfer.blockHash]);
      if (transfer.feeYoctonear !== null) await gasAccounting(client, payout, attempt, transfer.feeYoctonear);
      await payoutAccounting(client, payout, attempt);
    });
    log().info("near_payout_confirmed", { payoutId: payout.id, txHash: transfer.txHash });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await withSystem(async (client) => {
      await client.query("INSERT INTO payout_attempts (id, organization_id, environment, payout_id, attempt_number, status, error, raw) SELECT $1,$2,$3,$4,COALESCE((SELECT max(attempt_number)+1 FROM payout_attempts WHERE payout_id=$4),1),'failed',$5,'{}' ON CONFLICT (payout_id, attempt_number) DO NOTHING", [newId("payoutAttempt"), payout.organization_id, payout.environment, payout.id, detail.slice(0, 1000)]);
      await client.query("UPDATE payout_requests SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = 'submitting'", [payout.id, detail.slice(0, 1000)]);
    });
    log().error("near_payout_failed", { payoutId: payout.id, error: detail });
  }
}

/** Process at most one approved payout per tick; safe to run from multiple workers. */
export async function processDuePayouts(): Promise<{ processed: number }> {
  const payout = await claimPayout();
  if (!payout) return { processed: 0 };
  await processOne(payout);
  return { processed: 1 };
}

export function serializePayout(row: Row) {
  return {
    id: row.id,
    object: "payout",
    kind: row.kind,
    status: row.status,
    wallet_id: row.wallet_id,
    network_id: row.network_id,
    asset_id: row.asset_id,
    token_address: row.token_address,
    recipient: row.recipient,
    amount_base_units: String(row.amount),
    memo: row.memo ?? null,
    payment_id: row.payment_id ?? null,
    invoice_id: row.invoice_id ?? null,
    tx_hash: row.tx_hash ?? null,
    block_hash: row.block_hash ?? null,
    error: row.error ?? null,
    requested_at: row.requested_at,
    approved_at: row.approved_at,
    confirmed_at: row.confirmed_at,
    updated_at: row.updated_at
  };
}

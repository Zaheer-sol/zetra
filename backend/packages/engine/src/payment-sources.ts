import { appEnv, paymentNetworkById } from "@zetra/config";
import { withSystem, withTenant, type Client } from "@zetra/database";
import { verifySignature } from "@zetra/events";
import { canonicalPaymentEventKey, canonicalPaymentEventSchema, newId, type CanonicalPaymentEvent, type Environment } from "@zetra/schemas";
import { decryptSecret, encryptSecret, randomToken } from "@zetra/security";
import { ingestObservation, type Stage, type WalletRef } from "./pipeline";
import { audit, EngineError, log, type Actor } from "./context";

type Row = Record<string, any>;

export interface PaymentSourceInput {
  kind: "near" | "processor";
  provider: string;
  name: string;
  webhookSecret?: string;
}

export interface PaymentSourceResult {
  status: number;
  outcome: "received" | "processed" | "ignored" | "failed" | "rejected";
  event_id?: string;
  payment_id?: string | null;
  duplicate?: boolean;
  detail?: string;
}

const header = (headers: Record<string, string | string[] | undefined>, name: string) => {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

export async function createPaymentSource(client: Client, organizationId: string, environment: Environment, input: PaymentSourceInput, actor: Actor) {
  const secret = input.webhookSecret?.trim() || `psec_${randomToken(24)}`;
  const id = newId("paymentSource");
  await client.query(
    `INSERT INTO payment_sources (id, organization_id, environment, kind, provider, name, secret_ciphertext, secret_hint, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, organizationId, environment, input.kind, input.provider, input.name, encryptSecret(secret, appEnv().encryptionKey), `…${secret.slice(-4)}`, actor.id ?? null]
  );
  await audit(client, actor, {
    organizationId,
    environment,
    action: "payment_source_created",
    objectType: "payment_source",
    objectId: id,
    next: { kind: input.kind, provider: input.provider, name: input.name }
  });
  const source = (await client.query("SELECT * FROM payment_sources WHERE id = $1", [id])).rows[0] as Row;
  return { source, secret };
}

export async function setPaymentSourceStatus(client: Client, organizationId: string, sourceId: string, status: "active" | "disabled", actor: Actor) {
  const before = (await client.query("SELECT * FROM payment_sources WHERE id = $1 AND organization_id = $2 FOR UPDATE", [sourceId, organizationId])).rows[0] as Row | undefined;
  if (!before) throw new EngineError("not_found", "No such payment source.", 404);
  await client.query("UPDATE payment_sources SET status = $1, updated_at = now() WHERE id = $2", [status, sourceId]);
  await audit(client, actor, {
    organizationId,
    environment: before.environment,
    action: `payment_source_${status}`,
    objectType: "payment_source",
    objectId: sourceId,
    previous: { status: before.status },
    next: { status }
  });
  return (await client.query("SELECT * FROM payment_sources WHERE id = $1", [sourceId])).rows[0] as Row;
}

/**
 * Receive one signed canonical event. The event is persisted before any matching is attempted;
 * retries therefore return the original result and can never post the same payment twice.
 */
export async function receivePaymentSourceEvent(sourceId: string, headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<PaymentSourceResult> {
  const source = (await withSystem((c) => c.query("SELECT * FROM payment_sources WHERE id = $1", [sourceId]))).rows[0] as Row | undefined;
  if (!source) return { status: 404, outcome: "rejected", detail: "No such payment source." };
  if (source.status !== "active") return { status: 410, outcome: "rejected", detail: "This payment source is turned off." };
  const secret = decryptSecret(source.secret_ciphertext, appEnv().encryptionKey);
  if (!verifySignature(secret, rawBody, header(headers, "x-zetra-timestamp"), header(headers, "x-zetra-signature"))) {
    return { status: 401, outcome: "rejected", detail: "The signature or timestamp doesn't match this payment source's secret." };
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return { status: 422, outcome: "rejected", detail: "The body isn't valid JSON." };
  }
  const parsed = canonicalPaymentEventSchema.safeParse(parsedBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: 422, outcome: "rejected", detail: `${issue?.path.join(".") || "event"}: ${issue?.message ?? "invalid canonical payment event"}` };
  }
  const event = parsed.data;
  if (event.source.kind !== source.kind || event.source.provider !== source.provider) {
    return { status: 422, outcome: "rejected", detail: "The event source does not match this payment source connection." };
  }
  if (event.source.connection_id && event.source.connection_id !== source.id) {
    return { status: 422, outcome: "rejected", detail: "The event connection_id does not match this payment source." };
  }

  return withTenant(source.organization_id, async (client) => processPaymentSourceEvent(client, source, event));
}

async function processPaymentSourceEvent(client: Client, source: Row, event: CanonicalPaymentEvent): Promise<PaymentSourceResult> {
  const key = canonicalPaymentEventKey(event);
  const eventId = newId("paymentSourceEvent");
  const inserted = await client.query(
    `INSERT INTO payment_source_events (id, organization_id, environment, source_id, canonical_key, provider_event_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (source_id, canonical_key) DO NOTHING
     RETURNING id`,
    [eventId, source.organization_id, source.environment, source.id, key, event.source.event_id, JSON.stringify(event)]
  );
  if (!inserted.rows[0]) {
    const previous = (await client.query("SELECT id, status, payment_id, processing_error FROM payment_source_events WHERE source_id = $1 AND canonical_key = $2", [source.id, key])).rows[0] as Row;
    return {
      status: 200,
      outcome: previous.status,
      event_id: previous.id,
      payment_id: previous.payment_id,
      duplicate: true,
      detail: previous.processing_error ?? undefined
    };
  }

  await client.query("UPDATE payment_sources SET last_event_at = now(), last_error = NULL, updated_at = now() WHERE id = $1", [source.id]);
  const actor: Actor = { type: "system", id: source.id, label: `Payment source · ${source.name}` };
  try {
    const result = await processCanonicalEvent(client, source, event, actor);
    await client.query(
      "UPDATE payment_source_events SET status = $2, payment_id = $3, processing_error = $4, processed_at = now(), updated_at = now() WHERE id = $1",
      [eventId, result.outcome, result.paymentId, result.detail ?? null]
    );
    return { status: 200, outcome: result.outcome, event_id: eventId, payment_id: result.paymentId, detail: result.detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The event could not be processed.";
    await client.query("UPDATE payment_source_events SET status = 'failed', processing_error = $2, processed_at = now(), updated_at = now() WHERE id = $1", [eventId, detail.slice(0, 500)]);
    await client.query("UPDATE payment_sources SET last_error = $2, updated_at = now() WHERE id = $1", [source.id, detail.slice(0, 500)]);
    log().error("payment_source_event_failed", { organizationId: source.organization_id, sourceId: source.id, eventId, error: detail });
    return { status: 200, outcome: "failed", event_id: eventId, payment_id: null, detail };
  }
}

async function processCanonicalEvent(client: Client, source: Row, event: CanonicalPaymentEvent, actor: Actor): Promise<{ outcome: "processed" | "ignored"; paymentId: string | null; detail?: string }> {
  if (["failed", "expired", "refunded", "disputed", "reversed"].includes(event.status)) {
    return { outcome: "ignored", paymentId: null, detail: `Lifecycle status ${event.status} does not create a new payment.` };
  }
  if (!["detected", "confirming", "finalized", "settled"].includes(event.status)) {
    return { outcome: "ignored", paymentId: null, detail: `Lifecycle status ${event.status} is retained until it becomes confirming or settled.` };
  }
  const evidence = event.chain_evidence;
  if (!evidence) {
    return { outcome: "ignored", paymentId: null, detail: "Accepted and retained; waiting for a finalized NEAR settlement proof." };
  }
  const network = paymentNetworkById(event.asset.network);
  if (!network || !event.asset.network.startsWith("near:")) {
    return { outcome: "ignored", paymentId: null, detail: "Retained without accounting: only native NEAR settlement evidence is enabled." };
  }
  if (!event.recipient?.address || !event.payer?.address) {
    return { outcome: "ignored", paymentId: null, detail: "Retained without accounting: payer and recipient are required for a NEAR transfer." };
  }
  const wallet = (
    await client.query(
      `SELECT id, organization_id, environment, network_id, name, address
         FROM wallets WHERE organization_id = $1 AND environment = $2 AND network_id = $3
           AND lower(address) = lower($4) AND archived_at IS NULL AND monitoring_enabled = true`,
      [source.organization_id, source.environment, event.asset.network, event.recipient.address]
    )
  ).rows[0] as WalletRef | undefined;
  if (!wallet) return { outcome: "ignored", paymentId: null, detail: "Retained without accounting: the recipient wallet is not connected to this workspace." };

  const asset = network.assets.find((candidate) => candidate.contractId.toLowerCase() === event.asset.address.toLowerCase());
  if (!asset) return { outcome: "ignored", paymentId: null, detail: "Retained without accounting: the token is not enabled for this NEAR network." };
  const amount = event.asset.amount_base_units ? BigInt(event.asset.amount_base_units) : decimalToBaseUnits(event.asset.amount, asset.decimals);
  const stage: Stage = event.status === "detected" || event.status === "confirming" ? "tip" : "settled";
  const ingested = await ingestObservation(client, wallet, {
    sourceType: "nep141_transfer",
    networkId: event.asset.network,
    blockNumber: BigInt(evidence.block_number),
    blockHash: evidence.block_hash,
    transactionHash: evidence.transaction_hash,
    transactionIndex: evidence.transaction_index,
    logIndex: evidence.log_index,
    outcomeId: evidence.outcome_id,
    transferIndex: evidence.transfer_index,
    assetId: asset.id,
    tokenAddress: event.asset.address,
    fromAddress: event.payer.address,
    toAddress: event.recipient.address,
    amount,
    blockTimestamp: new Date(event.occurred_at),
    raw: { canonical_event: event, source_id: source.id },
    detectionSource: "rpc"
  }, stage);
  if (!ingested.paymentId) return { outcome: "processed", paymentId: null, detail: "Evidence recorded; no payment row was created." };
  return { outcome: "processed", paymentId: ingested.paymentId, detail: stage === "settled" ? "NEAR evidence ingested and settled through the standard matching and accounting pipeline." : "NEAR evidence ingested as confirming; finality will settle it through the standard pipeline." };
}

function decimalToBaseUnits(value: string, decimals: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Amount has more than ${decimals} decimal places for this asset`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function serializePaymentSource(row: Row) {
  return {
    id: row.id,
    object: "payment_source",
    kind: row.kind,
    provider: row.provider,
    name: row.name,
    status: row.status,
    secret_hint: row.secret_hint,
    inbound_url: `${appEnv().publicAppUrl.replace(/\/$/, "")}/api/v1/inbound/payment-sources/${row.id}`,
    last_event_at: row.last_event_at,
    last_error: row.last_error,
    created_at: row.created_at
  };
}

export function serializePaymentSourceEvent(row: Row) {
  return {
    id: row.id,
    object: "payment_source_event",
    source_id: row.source_id,
    canonical_key: row.canonical_key,
    provider_event_id: row.provider_event_id,
    status: row.status,
    payment_id: row.payment_id,
    processing_error: row.processing_error,
    received_at: row.received_at,
    processed_at: row.processed_at
  };
}

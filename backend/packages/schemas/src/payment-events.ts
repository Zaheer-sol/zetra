import { z } from "zod";

/**
 * The common payment vocabulary shared by direct wallet observations and future processor
 * adapters. Adapters may keep provider-specific fields in `raw`, but everything Zetra needs for
 * matching, settlement and accounting must be present in this envelope.
 */
export const PAYMENT_EVENT_STATUSES = [
  "initiated",
  "detected",
  "confirming",
  "finalized",
  "settled",
  "failed",
  "expired",
  "refunded",
  "disputed",
  "reversed"
] as const;
export type PaymentEventStatus = (typeof PAYMENT_EVENT_STATUSES)[number];

export const PAYMENT_EVENT_SOURCE_KINDS = ["near", "processor"] as const;
export type PaymentEventSourceKind = (typeof PAYMENT_EVENT_SOURCE_KINDS)[number];

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const decimal = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/, "Use a decimal string");
const baseUnits = z.string().regex(/^(0|[1-9]\d*)$/, "Use non-negative integer base units");

const paymentEventSource = z.object({
  kind: z.enum(PAYMENT_EVENT_SOURCE_KINDS),
  provider: nonEmpty(80),
  connection_id: nonEmpty(160).optional(),
  event_id: nonEmpty(240),
  payment_id: nonEmpty(240).optional(),
  order_id: nonEmpty(240).optional(),
  invoice_reference: nonEmpty(240).optional()
});

const paymentEventParty = z.object({
  address: nonEmpty(256),
  label: z.string().trim().max(160).optional()
});

const paymentEventTransaction = z.object({
  hash: nonEmpty(256),
  network: nonEmpty(80),
  role: z.enum(["payment", "settlement", "refund"])
});

/** Optional chain proof attached by a source that has already observed settlement on NEAR. */
const paymentEventChainEvidence = z.object({
  block_number: baseUnits,
  block_hash: nonEmpty(256),
  transaction_hash: nonEmpty(256),
  transaction_index: z.number().int().nonnegative().max(1_000_000).default(0),
  log_index: z.number().int().nonnegative().max(1_000_000).default(0),
  outcome_id: nonEmpty(256).optional(),
  transfer_index: z.number().int().nonnegative().max(1_000_000).optional()
});

const paymentEventFees = z.object({
  provider: decimal.optional(),
  network: decimal.optional(),
  currency: nonEmpty(16).optional()
});

/** Canonical payment event accepted at the processor/settlement boundary. */
export const canonicalPaymentEventSchema = z.object({
  object: z.literal("payment_event"),
  schema_version: z.literal("1.0"),
  source: paymentEventSource,
  status: z.enum(PAYMENT_EVENT_STATUSES),
  asset: z.object({
    symbol: nonEmpty(32),
    address: nonEmpty(256),
    network: nonEmpty(80),
    decimals: z.number().int().min(0).max(30),
    amount: decimal,
    amount_base_units: baseUnits.optional()
  }),
  payer: paymentEventParty.nullable(),
  recipient: paymentEventParty.nullable(),
  fees: paymentEventFees.default({}),
  transactions: z.array(paymentEventTransaction).max(16).default([]),
  chain_evidence: paymentEventChainEvidence.optional(),
  occurred_at: z.string().datetime({ offset: true }),
  observed_at: z.string().datetime({ offset: true }),
  finalized_at: z.string().datetime({ offset: true }).nullable().default(null),
  raw_reference: nonEmpty(512).optional(),
  raw: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).default({})
});

export type CanonicalPaymentEvent = z.infer<typeof canonicalPaymentEventSchema>;

/** Stable source identity used for database idempotency and replay-safe adapter processing. */
export function canonicalPaymentEventKey(event: Pick<CanonicalPaymentEvent, "source">): string {
  return `${event.source.kind}:${event.source.provider}:${event.source.event_id}`;
}

import { describe, expect, it } from "vitest";
import { canonicalPaymentEventKey, canonicalPaymentEventSchema } from "./payment-events";

const valid = {
  object: "payment_event",
  schema_version: "1.0",
  source: { kind: "processor", provider: "example", connection_id: "conn_1", event_id: "evt_1", payment_id: "pay_1" },
  status: "settled",
  asset: { symbol: "USDC", address: "usdc.fakes.testnet", network: "near:testnet", decimals: 6, amount: "125.00", amount_base_units: "125000000" },
  payer: { address: "alice.testnet" },
  recipient: { address: "merchant.testnet" },
  fees: { provider: "1.25", network: "0.01", currency: "USD" },
  transactions: [{ hash: "tx-hash", network: "near:testnet", role: "payment" }],
  occurred_at: "2026-11-03T10:00:00.000Z",
  observed_at: "2026-11-03T10:00:04.000Z",
  finalized_at: "2026-11-03T10:00:08.000Z",
  raw_reference: "provider://example/events/evt_1",
  raw: { provider_status: "paid" },
  metadata: { invoice: "INV-1" }
};

describe("canonical payment events", () => {
  it("parses provider events and derives a stable idempotency key", () => {
    const event = canonicalPaymentEventSchema.parse(valid);
    expect(event.status).toBe("settled");
    expect(event.fees.provider).toBe("1.25");
    expect(canonicalPaymentEventKey(event)).toBe("processor:example:evt_1");
  });

  it("rejects events that do not carry source identity or a valid amount", () => {
    expect(canonicalPaymentEventSchema.safeParse({ ...valid, source: { kind: "processor", provider: "example", event_id: "" } }).success).toBe(false);
    expect(canonicalPaymentEventSchema.safeParse({ ...valid, asset: { ...valid.asset, amount: "-1" } }).success).toBe(false);
  });

  it("allows direct NEAR events without pretending they came from a processor", () => {
    const event = canonicalPaymentEventSchema.parse({ ...valid, source: { kind: "near", provider: "near-rpc", event_id: "tx:0" }, status: "finalized" });
    expect(event.source.kind).toBe("near");
    expect(canonicalPaymentEventKey(event)).toBe("near:near-rpc:tx:0");
  });
});

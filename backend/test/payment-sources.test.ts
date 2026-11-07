import { randomBytes } from "node:crypto";
import { createHmac } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closePools } from "../packages/database/src";
import { sign } from "../packages/events/src";
import { apiKey, call, server, setupWorkspace, signup, type Session } from "./helpers";

afterAll(async () => {
  await (await server()).close();
  await closePools();
});

const auth = (s: Session) => ({ cookie: s.cookie });

describe("canonical payment sources", () => {
  const inject = async (sourceId: string, raw: string, secret: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    return (await server()).inject({
      method: "POST",
      url: `/v1/inbound/payment-sources/${sourceId}`,
      headers: {
        "content-type": "application/json",
        "x-zetra-timestamp": String(timestamp),
        "x-zetra-signature": `v1=${sign(secret, timestamp, raw)}`
      },
      payload: raw
    });
  };

  it("persists provider events, waits for chain proof, then settles through the real matcher and books", async () => {
    const s = await signup();
    const { wallet, acme, acmeAddress } = await setupWorkspace(s);
    const key = await apiKey(s);
    const invoice = (await call("POST", "/v1/invoices", auth(s), { customer_id: acme.id, title: "Canonical source payment", amount: "12.34" })).data;
    const source = (await call("POST", "/v1/payment-sources", auth(s), { kind: "processor", provider: "example", name: `Example ${randomBytes(3).toString("hex")}` })).data;
    expect(source.secret).toMatch(/^psec_/);
    expect(source.inbound_url).toContain(`/inbound/payment-sources/${source.id}`);

    const waiting = {
      object: "payment_event",
      schema_version: "1.0",
      source: { kind: "processor", provider: "example", connection_id: source.id, event_id: "evt-waiting" },
      status: "settled",
      asset: { symbol: "USDC", address: "usdc.fakes.testnet", network: "near:testnet", decimals: 6, amount: "12.34", amount_base_units: "12340000" },
      payer: { address: acmeAddress },
      recipient: { address: wallet.address },
      transactions: [],
      occurred_at: new Date().toISOString(),
      observed_at: new Date().toISOString()
    };
    const retained = await inject(source.id, JSON.stringify(waiting), source.secret);
    expect(retained.statusCode).toBe(200);
    expect(retained.json()).toMatchObject({ outcome: "ignored", duplicate: false });
    expect(retained.json().detail).toMatch(/waiting for a finalized NEAR settlement proof/);

    const settled = {
      ...waiting,
      source: { ...waiting.source, event_id: "evt-settled" },
      chain_evidence: {
        block_number: "42",
        block_hash: "block-hash-42",
        transaction_hash: "transaction-hash-42-abcdefghijklmnopqrstuvwxyz123456",
        transaction_index: 0,
        log_index: 0,
        transfer_index: 0
      }
    };
    const posted = await inject(source.id, JSON.stringify(settled), source.secret);
    expect(posted.statusCode).toBe(200);
    expect(posted.json()).toMatchObject({ outcome: "processed", duplicate: false });
    expect(posted.json().payment_id).toMatch(/^pay_/);
    const payment = (await call("GET", `/v1/payments/${posted.json().payment_id}`, { key })).data;
    expect(payment.status).toBe("matched");
    expect(payment.invoice.id).toBe(invoice.id);
    const refund = await call("POST", `/v1/payments/${posted.json().payment_id}/refund`, auth(s), { amount: "7.00", idempotency_key: "refund-test-0001" });
    expect(refund.statusCode).toBe(201);
    expect(refund.data.status).toBe("pending_approval");
    const excessiveRefund = await call("POST", `/v1/payments/${posted.json().payment_id}/refund`, auth(s), { amount: "6.00", idempotency_key: "refund-test-0002" });
    expect(excessiveRefund.statusCode).toBe(422);
    expect(excessiveRefund.data.error.code).toBe("refund_too_large");
    expect((await call("GET", "/v1/exceptions/summary", auth(s))).data).toMatchObject({ object: "exception_summary", open_count: 0, older_than_24h: 0 });

    const retry = await inject(source.id, JSON.stringify(settled), source.secret);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ outcome: "processed", duplicate: true, payment_id: posted.json().payment_id });
    const events = (await call("GET", `/v1/payment-sources/${source.id}/events`, auth(s))).data.data;
    expect(events.map((event: any) => event.status).sort()).toEqual(["ignored", "processed"]);
  });

  it("rejects forged or mismatched source events without creating evidence", async () => {
    const s = await signup();
    await setupWorkspace(s);
    const source = (await call("POST", "/v1/payment-sources", auth(s), { kind: "near", provider: "near-rpc", name: "Native NEAR" })).data;
    const raw = JSON.stringify({
      object: "payment_event",
      schema_version: "1.0",
      source: { kind: "near", provider: "wrong-provider", event_id: "evt-1" },
      status: "detected",
      asset: { symbol: "USDC", address: "usdc.fakes.testnet", network: "near:testnet", decimals: 6, amount: "1.00" },
      payer: { address: "alice.testnet" },
      recipient: { address: "merchant.testnet" },
      occurred_at: new Date().toISOString(),
      observed_at: new Date().toISOString()
    });
    expect((await inject(source.id, raw, "psec_wrong")).statusCode).toBe(401);
    expect((await inject(source.id, raw, source.secret)).statusCode).toBe(422);
    expect((await call("GET", `/v1/payment-sources/${source.id}/events`, auth(s))).data.data).toHaveLength(0);
  });

  it("reconciles a signed Stripe Checkout receipt into the invoice and clearing books", async () => {
    const s = await signup();
    const { acme } = await setupWorkspace(s);
    const invoice = (await call("POST", "/v1/invoices", auth(s), { customer_id: acme.id, title: "Stripe receipt", amount: "12.34" })).data;
    const secret = "whsec_zetra_test_secret";
    const source = (await call("POST", "/v1/payment-sources", auth(s), { kind: "processor", provider: "stripe", name: `Stripe ${randomBytes(3).toString("hex")}`, webhook_secret: secret })).data;
    const timestamp = Math.floor(Date.now() / 1000);
    const event = {
      id: `evt_${randomBytes(8).toString("hex")}`,
      type: "payment_intent.succeeded",
      created: timestamp,
      data: { object: { id: `pi_${randomBytes(8).toString("hex")}`, amount_received: 1234, currency: "usd", metadata: { zetra_invoice_id: invoice.id } } }
    };
    const raw = JSON.stringify(event);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    const posted = await (await server()).inject({ method: "POST", url: `/v1/inbound/payment-sources/${source.id}/stripe`, headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` }, payload: raw });
    expect(posted.statusCode).toBe(200);
    expect(posted.json()).toMatchObject({ outcome: "processed" });
    expect((await call("GET", `/v1/invoices/${invoice.id}`, auth(s))).data.status).toBe("paid");
    const reconciliation = (await call("GET", "/v1/reconciliation", auth(s))).data;
    expect(reconciliation.summary.received).toBe("12.34");
    expect(reconciliation.summary.applied).toBe("12.34");
    expect(reconciliation.processor_receipts).toMatchObject({ count: 1, applied: 1, needs_review: 0 });
    expect(reconciliation.settled_invoices.find((row: any) => row.id === invoice.id).payments).toBe(1);
    const overview = (await call("GET", "/v1/overview?period=today", auth(s))).data;
    expect(overview.metrics.received).toBe("12.34");
    expect(overview.metrics.payments).toBe(1);
    expect(overview.books.checks.find((check: any) => check.key === "missing_entries").status).toBe("ok");
    const repaired = await call("POST", "/v1/accounting/repair", auth(s), {});
    expect(repaired.statusCode).toBe(200);
    expect(repaired.data.health.checks.find((check: any) => check.key === "missing_entries").status).toBe("ok");
    const checkoutEvent = {
      id: `evt_${randomBytes(8).toString("hex")}`,
      type: "checkout.session.completed",
      created: timestamp,
      data: { object: { id: `cs_${randomBytes(8).toString("hex")}`, payment_intent: event.data.object.id, payment_status: "paid", amount_total: 1234, currency: "usd", metadata: { zetra_invoice_id: invoice.id } } }
    };
    const checkoutRaw = JSON.stringify(checkoutEvent);
    const checkoutSignature = createHmac("sha256", secret).update(`${timestamp}.${checkoutRaw}`).digest("hex");
    const checkoutDuplicate = await (await server()).inject({ method: "POST", url: `/v1/inbound/payment-sources/${source.id}/stripe`, headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${checkoutSignature}` }, payload: checkoutRaw });
    expect(checkoutDuplicate.json()).toMatchObject({ outcome: "processed", duplicate: true });
    const duplicate = await (await server()).inject({ method: "POST", url: `/v1/inbound/payment-sources/${source.id}/stripe`, headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` }, payload: raw });
    expect(duplicate.json()).toMatchObject({ outcome: "processed", duplicate: true });
  });
});

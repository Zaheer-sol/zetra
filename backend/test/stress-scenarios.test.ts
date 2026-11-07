import { afterAll, describe, expect, it } from "vitest";
import { closePools } from "../packages/database/src";
import { call, server, setupWorkspace, signup } from "./helpers";

afterAll(async () => {
  await (await server()).close();
  await closePools();
});

describe("reconciliation stress scenarios", () => {
  it("exposes and runs every labelled scenario through the normal pipeline", async () => {
    const session = await signup("Stress Scenario Lab");
    const { acme, acmeAddress } = await setupWorkspace(session);
    const auth = { cookie: session.cookie };

    const invoice = async (amount: string, extra: Record<string, unknown> = {}) => {
      const response = await call("POST", "/v1/invoices", auth, { customer_id: acme.id, title: `Stress ${amount}`, amount, ...extra });
      expect(response.statusCode).toBe(201);
      return response.data;
    };
    const payment = async (id: string) => {
      const response = await call("GET", `/v1/payments/${id}`, auth);
      expect(response.statusCode).toBe(200);
      return response.data;
    };
    const run = async (scenario: string, body: Record<string, unknown> = {}) => {
      const response = await call("POST", "/v1/test/scenarios", auth, { scenario, ...body });
      expect(response.statusCode).toBe(201);
      expect(response.data.simulated).toBe(true);
      expect(response.data.note).toContain("no on-chain transaction");
      return response.data;
    };

    const catalog = await call("GET", "/v1/test/scenarios", auth);
    expect(catalog.statusCode).toBe(200);
    expect(catalog.data.data.map((entry: any) => entry.id)).toEqual(expect.arrayContaining([
      "exact", "partial", "overpaid", "duplicate", "wrong_memo", "wrong_token", "unknown_sender",
      "late", "split", "refund", "reorg", "unsupported_account"
    ]));

    const exactInvoice = await invoice("10.00");
    const exact = await run("exact", { invoice_id: exactInvoice.id });
    expect((await payment(exact.payment_id)).status).toBe("matched");
    const paymentEvidence = await call("GET", `/v1/payments/${exact.payment_id}/evidence`, auth);
    expect(paymentEvidence.statusCode).toBe(200);
    expect(paymentEvidence.data.simulated).toBe(true);
    expect(paymentEvidence.data.nodes.map((node: any) => node.type)).toEqual(expect.arrayContaining([
      "invoice", "payment_request", "wallet", "transaction", "finalized_block", "receipt_outcome",
      "nep141_transfer", "matching", "reconciliation", "journal_entry", "report_allocation"
    ]));
    expect(paymentEvidence.data.nodes.find((node: any) => node.type === "transaction").explanation).toContain("no on-chain transaction");
    const invoiceEvidence = await call("GET", `/v1/invoices/${exactInvoice.id}/evidence`, auth);
    expect(invoiceEvidence.statusCode).toBe(200);
    expect(invoiceEvidence.data.payments[0].subject.id).toBe(exact.payment_id);

    const partialInvoice = await invoice("10.00");
    const partial = await run("partial", { invoice_id: partialInvoice.id, amount: "4.00" });
    expect((await payment(partial.payment_id)).status).toBe("partial");

    const overpaidInvoice = await invoice("10.00");
    const overpaid = await run("overpaid", { invoice_id: overpaidInvoice.id, amount: "12.00" });
    expect((await payment(overpaid.payment_id)).status).toBe("overpaid");

    const duplicateInvoice = await invoice("11.00");
    const first = await run("exact", { invoice_id: duplicateInvoice.id, wallet_id: undefined });
    const duplicate = await run("duplicate", { invoice_id: duplicateInvoice.id });
    expect((await payment(first.payment_id)).status).toBe("matched");
    expect((await payment(duplicate.payment_id)).status).toBe("needs_review");

    const wrongMemoInvoice = await invoice("13.00");
    const wrongMemo = await run("wrong_memo", { invoice_id: wrongMemoInvoice.id });
    expect((await payment(wrongMemo.payment_id)).status).toBe("needs_review");

    const wrongTokenInvoice = await invoice("14.00");
    const wrongToken = await run("wrong_token", { invoice_id: wrongTokenInvoice.id });
    expect((await payment(wrongToken.payment_id)).status).toBe("needs_review");

    const wrongNetworkInvoice = await invoice("14.50");
    const wrongNetwork = await run("wrong_network", { invoice_id: wrongNetworkInvoice.id });
    const wrongNetworkPayment = await payment(wrongNetwork.payment_id);
    expect(wrongNetworkPayment.status).toBe("needs_review");
    expect(wrongNetworkPayment.exceptions[0].type).toBe("wrong_network");

    const unknown = await run("unknown_sender", { amount: "7.40" });
    expect((await payment(unknown.payment_id)).status).toBe("needs_review");

    const lateInvoice = await invoice("15.00", { expires_at: new Date(Date.now() + 60_000).toISOString() });
    const late = await run("late", { invoice_id: lateInvoice.id });
    expect((await payment(late.payment_id)).status).toBe("needs_review");

    const splitInvoice = await invoice("16.00");
    const split = await run("split", { invoice_id: splitInvoice.id });
    expect(split.payment_ids).toHaveLength(2);
    expect((await payment(split.payment_ids[0])).status).toBe("partial");
    expect((await payment(split.payment_ids[1])).status).toBe("matched");

    const refundInvoice = await invoice("17.00");
    const refund = await run("refund", { invoice_id: refundInvoice.id });
    expect((await payment(refund.payment_id)).status).toBe("reversed");

    const reorgInvoice = await invoice("18.00");
    const reorg = await run("reorg", { invoice_id: reorgInvoice.id });
    expect((await payment(reorg.payment_id)).status).toBe("reversed");

    const unsupported = await run("unsupported_account", { amount: "1.00" });
    expect((await payment(unsupported.payment_id)).status).toBe("needs_review");

    // The fixture remains deterministic and uses a real known customer address only for the
    // duplicate assertion; no test result above represents an on-chain transaction.
    expect(acmeAddress).toContain(".testnet");
  });
});

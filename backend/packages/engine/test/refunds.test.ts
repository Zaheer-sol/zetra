import { afterAll, describe, expect, it } from "vitest";
import { closePools, withTenant, type Client } from "../../database/src";
import { confirmWalletSignedRefund, createRefundRequest, ingestObservation, submitWalletSignedPayout } from "../src";
import { invoice, transfer, usd, workspace, type Workspace } from "../../../../test/fixtures";

afterAll(closePools);

const q = (ws: Workspace, sql: string, params: unknown[] = []) =>
  withTenant(ws.orgId, (client: Client) => client.query(sql, params)).then((result) => result.rows);

describe("wallet-signed NEAR refunds", () => {
  it("reserves a partial refund idempotently, returns only to the original payer, and enforces the cumulative cap", async () => {
    const ws = await workspace();
    const target = await invoice(ws, "Acme Ltd", "10.00");
    const sender = ws.customers["Acme Ltd"]!.address!;
    const observation = transfer(ws, usd("10.00"), sender, { raw: { memo: `zetra:${target.public_token}` } });
    const ingested = await withTenant(ws.orgId, (client) => ingestObservation(client, ws.wallet, observation, "settled"));
    const [payment] = await q(ws, "SELECT * FROM payments WHERE id = $1", [ingested.paymentId]);

    const create = (amount: string, idempotencyKey: string) => withTenant(ws.orgId, (client) =>
      createRefundRequest(client, ws.orgId, ws.environment, payment.id, { amount, idempotencyKey }, ws.actor)
    );
    const refund = await create("2.50", "refund-partial-0001");
    expect(refund).toMatchObject({
      kind: "refund",
      status: "pending_approval",
      payment_id: payment.id,
      wallet_id: ws.wallet.id,
      recipient: sender,
      amount: usd("2.50").toString()
    });

    const retry = await create("2.50", "refund-partial-0001");
    expect(retry.id).toBe(refund.id);
    await expect(create("7.51", "refund-over-cap-0002")).rejects.toMatchObject({ code: "refund_too_large" });

    // A refund request is not a refund until a wallet-signed transaction is finalized and checked.
    await expect(withTenant(ws.orgId, (client) =>
      confirmWalletSignedRefund(client, ws.orgId, ws.environment, refund.id, "A".repeat(44), ws.actor)
    )).rejects.toMatchObject({ code: "refund_not_submitted" });

    const submitted = await withTenant(ws.orgId, (client) =>
      submitWalletSignedPayout(client, ws.orgId, ws.environment, refund.id, "A".repeat(44), ws.actor)
    );
    expect(submitted.status).toBe("submitted");
    expect((await q(ws, "SELECT count(*)::int AS count FROM payout_attempts WHERE payout_id = $1", [refund.id]))[0]!.count).toBe(0);
  });
});

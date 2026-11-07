import { afterAll, describe, expect, it } from "vitest";
import { closePools } from "../packages/database/src";
import { call, server, setupWorkspace, signup } from "./helpers";

afterAll(async () => {
  await (await server()).close();
  await closePools();
});

describe("approval-gated NEAR payouts", () => {
  it("creates an idempotent pending request and requires approval before submission", async () => {
    const session = await signup();
    const { wallet } = await setupWorkspace(session);
    const auth = { cookie: session.cookie };
    const payload = { kind: "payment", wallet_id: wallet.id, recipient: "recipient.testnet", amount: "1.00", asset: "USDC", idempotency_key: "payout-test-0001" };
    const created = await call("POST", "/v1/payouts", auth, payload);
    expect(created.statusCode).toBe(201);
    expect(created.data.status).toBe("pending_approval");
    const retry = await call("POST", "/v1/payouts", auth, payload);
    expect(retry.statusCode).toBe(201);
    expect(retry.data.id).toBe(created.data.id);
    const approved = await call("POST", `/v1/payouts/${created.data.id}/approve`, auth, {});
    expect(approved.statusCode).toBe(200);
    expect(approved.data.status).toBe("approved");
    const listed = await call("GET", "/v1/payouts?status=approved", auth);
    expect(listed.data.data.some((row: any) => row.id === created.data.id)).toBe(true);
  });
});

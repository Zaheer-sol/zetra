import { afterAll, describe, expect, it } from "vitest";
import { closePools } from "../packages/database/src";
import { call, randomAddress, server, setupWorkspace, signup } from "./helpers";

afterAll(async () => {
  await (await server()).close();
  await closePools();
});

describe("receiving wallet defaults", () => {
  it("lets a business choose its default and uses it for new invoices", async () => {
    const session = await signup("Wallet Default Business");
    const { wallet: first, acme } = await setupWorkspace(session);
    expect(first.is_default).toBe(true);

    const auth = { cookie: session.cookie };
    const secondResponse = await call("POST", "/v1/wallets", auth, {
      name: "Deployment Account",
      network: "near:testnet",
      address: randomAddress(),
      assets: ["USDC"]
    });
    expect(secondResponse.statusCode).toBe(201);
    expect(secondResponse.data.is_default).toBe(false);

    const selected = await call("PATCH", `/v1/wallets/${secondResponse.data.id}`, auth, { is_default: true });
    expect(selected.statusCode).toBe(200);
    expect(selected.data.is_default).toBe(true);

    const wallets = (await call("GET", "/v1/wallets", auth)).data.data;
    expect(wallets.filter((wallet: any) => wallet.is_default).map((wallet: any) => wallet.id)).toEqual([secondResponse.data.id]);

    const invoice = await call("POST", "/v1/invoices", auth, {
      customer_id: acme.id,
      title: "Uses the business default wallet",
      amount: "10.00"
    });
    expect(invoice.statusCode).toBe(201);
    expect(invoice.data.wallet_id).toBe(secondResponse.data.id);
    expect(invoice.data.receiving_address).toBe(secondResponse.data.address);
  });
});

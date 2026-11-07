import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "./processor-receipts";

describe("Stripe webhook verification", () => {
  it("accepts a current v1 signature and rejects tampering/replay", () => {
    const body = JSON.stringify({ id: "evt_demo", type: "payment_intent.succeeded" });
    const timestamp = 1_700_000_000;
    const secret = "whsec_demo";
    const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const header = `t=${timestamp},v1=${digest}`;
    expect(verifyStripeSignature(body, header, secret, timestamp)).toBe(true);
    expect(verifyStripeSignature(`${body}x`, header, secret, timestamp)).toBe(false);
    expect(verifyStripeSignature(body, header, secret, timestamp + 301)).toBe(false);
  });
});

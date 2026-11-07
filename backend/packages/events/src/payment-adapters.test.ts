import { describe, expect, it } from "vitest";
import type { CanonicalPaymentEvent } from "@zetra/schemas";
import { adapterName, type PaymentSourceAdapter } from "./payment-adapters";

describe("payment source adapter contract", () => {
  it("names adapters by source kind and provider", () => {
    const adapter = { kind: "processor", provider: "example" } as Pick<PaymentSourceAdapter, "kind" | "provider">;
    expect(adapterName(adapter)).toBe("processor:example");
  });

  it("keeps normalization separate from transport", async () => {
    const event = {} as CanonicalPaymentEvent;
    const adapter: PaymentSourceAdapter = {
      kind: "near",
      provider: "near-rpc",
      verifyWebhook: () => true,
      parseWebhook: () => [],
      normalize: () => event
    };
    expect(await adapter.verifyWebhook({ rawBody: "", headers: {}, connection: { id: "near", kind: "near", provider: "near-rpc" } })).toBe(true);
    expect(adapter.normalize({}, { id: "near", kind: "near", provider: "near-rpc" })).toBe(event);
  });
});

import { describe, expect, it } from "vitest";
import { validateWalletSignedPayoutActions } from "./payout-validation";

const expected = { recipient: "payer.testnet", amount: "5000000", memo: "Refund for payment-123" };
const transfer = (overrides: Record<string, unknown> = {}) => {
  const { deposit = "1", ...argumentOverrides } = overrides;
  return ({
  FunctionCall: {
    method_name: "ft_transfer",
    args: { receiver_id: expected.recipient, amount: expected.amount, memo: expected.memo, ...argumentOverrides },
    gas: "100000000000000",
    deposit: String(deposit)
  }
  });
};

describe("wallet-signed NEAR payout action validation", () => {
  it("accepts a single exact refund transfer", () => {
    expect(validateWalletSignedPayoutActions({ actions: [transfer()] }, expected, false)).toBe(0n);
  });

  it("rejects a refund with any extra action", () => {
    expect(() => validateWalletSignedPayoutActions({ actions: [transfer(), transfer()] }, expected, false)).toThrow(/only the requested USDC transfer/);
  });

  it.each([
    ["recipient", { receiver_id: "attacker.testnet" }],
    ["amount", { amount: "5000001" }],
    ["memo", { memo: "different-invoice" }],
    ["deposit", { deposit: "0" }]
  ])("rejects a modified %s", (_field, override) => {
    expect(() => validateWalletSignedPayoutActions({ actions: [transfer(override)] }, expected, false)).toThrow();
  });

  it("allows one recipient registration only for a vendor payment", () => {
    const registration = {
      FunctionCall: {
        method_name: "storage_deposit",
        args: { account_id: expected.recipient, registration_only: true },
        gas: "30000000000000",
        deposit: "1250000000000000000000"
      }
    };
    expect(validateWalletSignedPayoutActions({ actions: [registration, transfer()] }, expected, true)).toBe(1250000000000000000000n);
    expect(() => validateWalletSignedPayoutActions({ actions: [registration, transfer()] }, expected, false)).toThrow(/refund transaction/);
  });

  it("rejects registration to another account or arbitrary token calls", () => {
    expect(() => validateWalletSignedPayoutActions({ actions: [{ FunctionCall: { method_name: "storage_deposit", args: { account_id: "other.testnet", registration_only: true }, deposit: "1" } as Record<string, unknown> }, transfer()] }, expected, true)).toThrow(/registration/);
    expect(() => validateWalletSignedPayoutActions({ actions: [{ FunctionCall: { method_name: "ft_transfer_call", args: {}, deposit: "1" } }] }, expected, true)).toThrow(/outside the requested/);
  });
});

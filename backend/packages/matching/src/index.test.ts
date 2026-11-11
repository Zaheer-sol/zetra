import { describe, expect, it } from "vitest";
import { matchPayment, type InvoiceCandidate, type MatchContext, type ObservedPayment } from "./index";

const issuedAt = new Date("2026-11-01T00:00:00.000Z");
const invoice: InvoiceCandidate = {
  id: "invoice-1",
  number: "INV-1",
  customerId: "customer-1",
  customerName: "Acme",
  networkId: "near:testnet",
  walletId: "wallet-1",
  walletAddress: "merchant.testnet",
  assetId: "near_testnet_usdc",
  amountDue: 5_000_000n,
  amountPaid: 0n,
  amountWrittenOff: 0n,
  status: "open",
  issuedAt,
  dueAt: null,
  expiresAt: null
};
const context: MatchContext = {
  acceptedAssetIds: ["near_testnet_usdc"],
  invoices: [invoice],
  knownSender: null,
  decimals: 6
};
const payment: ObservedPayment = {
  networkId: "near:testnet",
  walletId: "wallet-1",
  walletName: "Main Wallet",
  walletAddress: "merchant.testnet",
  toAddress: "merchant.testnet",
  assetId: "near_testnet_usdc",
  assetSymbol: "USDC",
  fromAddress: "payer.testnet",
  amount: 5_000_000n,
  timestamp: new Date("2026-11-02T00:00:00.000Z"),
  invoiceReference: "invoice-1"
};

describe("receiving-account validation", () => {
  it("settles a memo-referenced payment sent to the invoice wallet", () => {
    expect(matchPayment(payment, context)).toMatchObject({ outcome: "matched", invoiceId: invoice.id });
  });

  it("holds a transfer sent to a different account without matching an invoice", () => {
    const decision = matchPayment({ ...payment, toAddress: "other.testnet" }, context);
    expect(decision).toMatchObject({ outcome: "needs_review", invoiceId: null, exceptionType: "wrong_receiving_account" });
    expect(decision.checks.find((check) => check.code === "receiving_wallet")).toMatchObject({ passed: false, label: "Unsupported receiving account" });
  });
});

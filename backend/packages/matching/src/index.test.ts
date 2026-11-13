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

describe("duplicate invoice payments", () => {
  it("retains a finalized second transfer as a review item instead of silently allocating it twice", () => {
    const settledInvoice: InvoiceCandidate = {
      ...invoice,
      amountPaid: 5_000_000n,
      status: "paid",
      paidAt: new Date("2026-11-02T01:00:00.000Z")
    };
    const decision = matchPayment(payment, { ...context, invoices: [settledInvoice] });

    expect(decision).toMatchObject({ outcome: "needs_review", invoiceId: null, exceptionType: "duplicate_payment" });
    expect(decision.candidates).toEqual([expect.objectContaining({ invoiceId: settledInvoice.id })]);
    expect(decision.explanation).toContain("predates the payment currently applied");
  });
});

describe("late invoice payments", () => {
  const dueAt = new Date("2026-11-02T00:00:00.000Z");
  const dueInvoice: InvoiceCandidate = { ...invoice, dueAt };

  it("keeps a memo-referenced payment received after the due date in review", () => {
    const decision = matchPayment({ ...payment, timestamp: new Date(dueAt.getTime() + 1) }, { ...context, invoices: [dueInvoice] });

    expect(decision).toMatchObject({ outcome: "needs_review", invoiceId: null, exceptionType: "late_payment", appliedAmount: 0n });
    expect(decision.explanation).toContain("past due");
    expect(decision.candidates).toEqual([expect.objectContaining({ invoiceId: dueInvoice.id })]);
  });

  it("does not auto-match an exact-amount payment from an unknown sender after the due date", () => {
    const decision = matchPayment(
      { ...payment, invoiceReference: null, timestamp: new Date(dueAt.getTime() + 1) },
      { ...context, invoices: [dueInvoice] }
    );

    expect(decision).toMatchObject({ outcome: "needs_review", invoiceId: null, exceptionType: "late_payment", appliedAmount: 0n });
    expect(decision.candidates).toEqual([expect.objectContaining({ invoiceId: dueInvoice.id })]);
  });

  it("does not route an unreferenced receipt to a current invoice when the sender also has a plausible past-due invoice", () => {
    const currentInvoice: InvoiceCandidate = { ...invoice, id: "invoice-current", number: "INV-CURRENT", dueAt: null };
    const decision = matchPayment(
      { ...payment, invoiceReference: null, timestamp: new Date(dueAt.getTime() + 1) },
      { ...context, knownSender: { customerId: invoice.customerId, customerName: invoice.customerName }, invoices: [currentInvoice, dueInvoice] }
    );

    expect(decision).toMatchObject({ outcome: "needs_review", invoiceId: null, exceptionType: "late_payment", appliedAmount: 0n });
    expect(decision.candidates.map((candidate) => candidate.invoiceId)).toEqual([dueInvoice.id, currentInvoice.id]);
  });

  it("still accepts a payment arriving exactly at the due-time cutoff", () => {
    const decision = matchPayment({ ...payment, timestamp: dueAt }, { ...context, invoices: [dueInvoice] });

    expect(decision).toMatchObject({ outcome: "matched", invoiceId: dueInvoice.id });
  });
});

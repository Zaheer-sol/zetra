import { describe, expect, it } from "vitest";
import { allocateRefundDebit } from "./refund-split";

describe("refund accounting source allocation", () => {
  it("clears unidentified receipts before using sales returns", () => {
    expect(allocateRefundDebit(10n, [{ accountId: "suspense", availableBaseUnits: 10n }], "sales")).toEqual([
      { accountId: "suspense", assetAmount: 10n }
    ]);
  });

  it("uses overpayment credit first and debits sales only for the applied portion", () => {
    expect(allocateRefundDebit(25n, [{ accountId: "customer-credits", availableBaseUnits: 20n }], "sales")).toEqual([
      { accountId: "customer-credits", assetAmount: 20n },
      { accountId: "sales", assetAmount: 5n }
    ]);
  });

  it("can reverse a previously classified receipt", () => {
    expect(allocateRefundDebit(8n, [{ accountId: "classified-income", availableBaseUnits: 8n }], "sales")).toEqual([
      { accountId: "classified-income", assetAmount: 8n }
    ]);
  });

  it("ignores non-credit balances and falls back to sales for an applied payment", () => {
    expect(allocateRefundDebit(5n, [{ accountId: "suspense", availableBaseUnits: -3n }], "sales")).toEqual([
      { accountId: "sales", assetAmount: 5n }
    ]);
  });
});

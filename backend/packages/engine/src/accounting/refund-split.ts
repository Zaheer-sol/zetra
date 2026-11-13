export type RefundCreditSource = { accountId: string; availableBaseUnits: bigint };
export type RefundDebit = { accountId: string; assetAmount: bigint };

/** Consume existing payment-linked credits first, then treat any remainder as a sales return. */
export function allocateRefundDebit(
  amountBaseUnits: bigint,
  sources: RefundCreditSource[],
  salesAccountId: string
): RefundDebit[] {
  if (amountBaseUnits <= 0n) throw new Error("Refund amount must be positive.");
  let remaining = amountBaseUnits;
  const debits: RefundDebit[] = [];
  for (const source of sources) {
    if (remaining === 0n) break;
    const available = source.availableBaseUnits > 0n ? source.availableBaseUnits : 0n;
    const assetAmount = available < remaining ? available : remaining;
    if (assetAmount > 0n) {
      debits.push({ accountId: source.accountId, assetAmount });
      remaining -= assetAmount;
    }
  }
  if (remaining > 0n) debits.push({ accountId: salesAccountId, assetAmount: remaining });
  return debits;
}

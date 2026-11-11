# Accountant review checklist

Use this checklist to review Zetra's books in about 30 minutes. Sign in to the deterministic demo
Zetra Demo workspace, open **Books**, and answer each item with **Yes / No / Unsure** plus a note.

## The ledger

1. Is the chart of accounts a sensible starting point for a small service business?
2. Does every posted entry balance, and is posted history protected from editing?
3. Do corrections create a reversal while retaining the original entry and reason?
4. Does closing a month block postings until an authorized reopen with a reason?
5. Does year-end close move the result into Retained Earnings without erasing the year's P&L?

## Incoming payments

6. Is it acceptable that a finalized USDC receipt first enters **Payments to Identify**, then moves
   against Accounts Receivable only after a safe invoice match?
7. Is unidentified money correctly excluded from revenue and disclosed as a liability?
8. Are overpayments held as customer credits until applied or otherwise resolved?
9. Is the prototype's documented 1:1 USDC/USD valuation policy acceptable for a pilot?

Outgoing NEAR transfers and refunds are approval-gated and recorded in the payout subledger. They
remain disabled until a dedicated signer is configured, and every finalized attempt records its
transaction and gas evidence. Review the payout queue before approving a transfer.

## Tie-outs

10. Does receivables aging equal the Accounts Receivable control account?
11. Does payables aging equal the Accounts Payable control account?
12. Does the balance sheet balance and cash flow reconcile to the change in cash?
13. Does the Books health check identify the same issues you would identify manually?
14. Does the `$740.00` demo receipt remain outside revenue until it is classified?

## Exports and workflow

15. Does the journal CSV import cleanly into the accountant's system?
16. Does bank reconciliation accept the expected statement layout and preserve an audit trail?
17. Would you accept these books from a client? If not, what must change?
18. May Zetra quote the verdict, with the reviewer named or anonymous?

See [accounting rules](accounting.md) and run `npm run demo:verify` before the review.

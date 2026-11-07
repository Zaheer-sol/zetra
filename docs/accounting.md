# Accounting rules

Zetra uses posted double-entry journals as the source of financial statements. Business records and
the ledger are tied together explicitly; reports never maintain separate hand-entered totals.

## Default method

New workspaces use accrual accounting in USD. Supported USDC receipts are valued at their USD peg
for the current prototype, and the rate used is retained with the journal lines. A production pilot
must review that policy with its accountant.

## Core postings

| Event | Debit | Credit |
| --- | --- | --- |
| Invoice issued | Accounts Receivable | Revenue and Taxes Payable, when applicable |
| Finalized supported receipt | Merchant wallet asset | Payments to Identify |
| Stripe receipt | Bank / Stripe clearing | Payments to Identify |
| Stripe receipt applied | Payments to Identify | Accounts Receivable (or Revenue under cash basis); excess to Customer Credits |
| Receipt safely applied | Payments to Identify | Accounts Receivable |
| Unidentified receipt | No second posting | Remains in Payments to Identify |
| Customer overpayment | Payments to Identify | Accounts Receivable up to the balance; excess to Customer Credits |
| Approved vendor bill | Expense or asset account | Accounts Payable |
| Vendor bill paid | Accounts Payable | Selected cash/wallet account |
| Confirmed NEAR refund | Customer Credits, Accounts Receivable or contra-revenue | Merchant wallet asset |
| Valued NEAR gas fee | Network Fees expense | Wallet's native NEAR asset |
| Correction | Reversal of the original entry | Equal opposite lines; original retained |

Revenue is recognized when an invoice is issued under accrual accounting, not when cash arrives.
Consequently, unidentified cash is never silently treated as sales.

## Reconciliation controls

- Every posted journal entry must balance before it can be committed.
- Posted entries cannot be edited; corrections are reversals with reasons.
- Finalized supported payments must have a receipt journal entry.
- Processor receipts must have a clearing journal and an invoice allocation before they affect
  receivables; duplicate provider events are idempotent.
- Every confirmed payout attempt has immutable transaction and gas evidence. Gas is valued only from
  an explicit NEAR/USD rate; missing valuation creates an accounting issue instead of a guessed USD
  amount.
- Accounts Receivable must equal unpaid invoice balances.
- Receivables aging exposes both its subledger total and control-account balance.
- Payables aging exposes the same tie-out for Accounts Payable.
- Trial balance, P&L, balance sheet and cash flow aggregate the same posted lines.
- Cash flow independently checks that categorized movement equals the change in cash.
- Closed periods reject new postings until an authorized user reopens them with a reason.

Run `npm run demo:verify` for a deterministic proof with known totals, and `npm run
test:integration` for edge cases including partial/overpaid/unknown payments, reversals, closed
periods, role enforcement, payables and exports.

If an automatic posting was interrupted or an accounting issue is resolved, an authorized
accountant can replay the idempotent rules with `POST /v1/accounting/repair`; it never edits or
deletes existing journal entries.

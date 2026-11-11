# Test-mode product walkthrough

This walkthrough uses clearly labelled simulated payments. It does not require a funded wallet,
create an on-chain transaction, or publish a contract.

## Prepare

From the repository root:

```bash
npm install
npm run setup:local
npm run dev
```

Open `http://localhost:3000/login` and use:

```text
demo@zetra.local
Zetra-Demo-2026!
```

The demo login opens its seeded Zetra Demo workspace. New signups get a separate empty Live workspace.
Demo records stay with the demo account, and simulated payments do not move funds. There is no mode switch.

## Follow the money

1. On **Dashboard**, confirm the Zetra Demo workspace and the books-health card reports that
   the trial balance and receivables agree.
2. Open **Invoices**. `DEMO-001` and `DEMO-002` are paid; `DEMO-003` is open for `$1,550.00`.
3. Open `DEMO-001`, then its hosted payment page. Inspect the NEAR receiving account, amount, asset,
   and invoice memo. Do not submit a wallet transaction during the simulated walkthrough.
4. Open **Payments**. Two receipts are matched. One `$740.00` receipt needs review because Zetra
   cannot safely identify it.
5. Open that receipt and inspect the stored matching evidence. It remains in **Payments to
   Identify**, outside revenue.
6. Open **Books → Reports**. Confirm the trial balance, balance sheet, cash flow and receivables aging.
7. Close an ended month from **Books**, then preview its **Proof of Close** package. Show the
   deterministic SHA-256 root, the balanced-books checks and the explicit prepared/not-attested
   state when no contract signer is configured. Previewing never creates a blockchain transaction.
8. Open a payment detail page and walk through its **Evidence graph** from invoice and payment
   request through the simulated receipt, matching decision, reconciliation and journal entry.
9. Open **Developers → Demo scenarios** and run the labelled stress scenarios (partial, duplicate,
   wrong token, late, split and reversal). Every result follows the normal pipeline and is marked
   `Simulation — no on-chain transaction.`
10. Run `npm run demo:verify` in a terminal to independently assert the exact accounting totals.

For a funded transfer later, follow [the testnet runbook](testnet-runbook.md). Never describe the
simulated examples as on-chain activity.

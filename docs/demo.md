# Zetra demo

## Before the demo

- Start the API, worker, and web application and sign in to a test workspace.
- Confirm that the workspace has a receiving wallet and an open invoice.
- Keep the workspace in test mode. A simulated payment exercises the application pipeline but does
  not send a transaction or move funds.

## Walkthrough

1. Create a payment request with a clear title, amount, and receiving wallet.
2. Open the hosted payment page and show the payer-facing details.
3. Simulate an exact payment in test mode. Confirm that the payment is marked simulated.
4. Open the invoice and payment to show the matching decision and its evidence.
5. Show the resulting ledger entry, then open the reports or export for the accountant.
6. If time permits, show a payment that needs review and resolve it with a recorded reason.

Do not describe a simulated payment as an on-chain transaction. Use the
[verification checklist](verification.md) before demonstrating a configured network.

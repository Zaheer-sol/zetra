# Funded NEAR testnet runbook

This is the remaining proof step. It intentionally requires a human-controlled testnet wallet and
must not be represented as complete until every verification below passes.

## Before moving funds

1. Create or select a NEAR testnet account controlled by the operator. Never put its seed phrase or
   private key in Zetra.
2. Use Circle’s official NEAR Testnet USDC contract: `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`. Claim USDC from Circle’s faucet with NEAR Testnet selected. Other faucet tokens with the same symbol use different contracts and are not interchangeable.
3. Obtain only testnet NEAR and test tokens needed for the single transfer.
4. Set `NEAR_TESTNET_ENABLED=true`, a recent finalized `NEAR_TESTNET_START_HEIGHT`, and the verified
   token contract in `.env`.
5. For sustained ingestion, set `FASTNEAR_API_KEY`.
6. Start PostgreSQL, API, worker and web; confirm the wallet screen reports advancing finalized
   blocks before sending anything.

## Execute one invoice

1. Add the merchant's public testnet receiving account to Zetra.
2. Create a test-mode customer and invoice for a small test amount.
3. Open the hosted payment page and verify receiver, token, amount and `zetra:<invoice token>` memo.
4. From the operator-controlled payer wallet, approve the standard NEP-141 transfer.
5. Record the transaction hash outside secrets and wait for finality plus worker ingestion.

## Required evidence

- The explorer shows a successful call to the configured token contract.
- The NEP-141 event receiver and amount equal the hosted payment instructions.
- Zetra stores the same transaction, outcome, contract, sender, receiver, amount, memo and finalized
  block.
- Exactly one payment exists after worker restarts or event replays.
- The payment matches the intended invoice, or enters review if any evidence is intentionally wrong.
- The invoice balance changes once.
- The receipt and application journals are posted once and each balances.
- Accounts Receivable agrees with remaining invoices.
- Trial balance and balance sheet remain balanced; cash flow reconciles.

## Prove a wallet-signed vendor payment/refund

1. Fund a business wallet with the configured NEAR Testnet USDC and enough NEAR for gas. Add the
   business account in Wallets and enable USDC. Add a vendor with a NEAR Testnet address, then create
   and approve a bill for that vendor.
2. Open the bill, select the funded business wallet, connect that same wallet, review the amount and
   vendor account, and sign the `ft_transfer`. If needed, the wallet also signs the USDC contract's
   minimum `storage_deposit` for the vendor account in the same transaction.
3. Wait for Zetra to confirm finality. Verify the chain transaction and NEP-141 event against the
   requested token, business sender, vendor receiver, amount and memo.
4. Confirm the bill payment and journal entry are recorded once (Dr Accounts Payable / Cr USDC
   wallet), and the bill's remaining balance changes by the confirmed amount only.
5. To demonstrate a refund, open a finalized incoming payment and use its Refund action. Connect the
   receiving business wallet, confirm the original payer and amount, and sign the return transfer.
   Verify finality and the compensating refund journal entry.
6. Confirm `payout_attempts` retains the finalized outcome and `network_fee_records` retains the exact
   yoctoNEAR fee. If a vendor token account was newly registered, confirm the separate storage
   deposit record. Configure a dated `NEAR/USD` rate before expecting valued gas/setup expense lines;
   without one Zetra raises an accounting issue rather than estimating.

Other approved payout requests can use the runtime signer. Keep
`NEAR_TESTNET_PAYOUT_SIGNER_ID` and `NEAR_TESTNET_PAYOUT_PRIVATE_KEY` in the runtime secret manager
only, never in source control or chat. The worker must use the account matching the configured payout
wallet. Do not treat a worker or local simulation as a wallet-signed testnet payment.

For worker-signed payouts, a submission failure remains auditable as `failed` and can be reviewed and
re-approved after the signer or network issue is corrected; the worker never silently retries a
request that was not approved. A worker crash during an RPC call leaves the request `submitting`
instead of guessing whether funds moved; inspect the chain before any manual retry.

## Prove a Stripe processor receipt

Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (or pass the endpoint signing secret as
the encrypted `webhook_secret` when creating a Stripe payment source), then point Stripe at
`/v1/inbound/payment-sources/:id/stripe`. Create Checkout with
`POST /v1/invoices/:id/stripe-checkout`, complete a test payment, and verify the invoice, processor
receipt, clearing/application journal entries and idempotent retry.

After the run, execute `npm run demo:verify` for the deterministic demo and the full automated suite
with `npm run verify`. Add the new public transaction evidence to the documentation only after
manually reviewing it. Do not commit wallet credentials or hosted secrets.

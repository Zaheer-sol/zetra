# Funded NEAR testnet runbook

This is the remaining proof step. It intentionally requires a human-controlled testnet wallet and
must not be represented as complete until every verification below passes.

## Before moving funds

1. Create or select a NEAR testnet account controlled by the operator. Never put its seed phrase or
   private key in Zetra.
2. Confirm the configured USDC test token contract independently. The default
   `usdc.fakes.testnet` has no real-world value.
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

## Prove an outgoing payout/refund

1. Use a dedicated low-balance signer account whose address exactly matches the Zetra payout wallet.
2. Provide `NEAR_TESTNET_PAYOUT_SIGNER_ID` and `NEAR_TESTNET_PAYOUT_PRIVATE_KEY` through the runtime
   secret manager only; never commit them or send them in chat.
3. Create a payout with `POST /v1/payouts`, inspect the recipient and amount, then approve it with
   `POST /v1/payouts/:id/approve`. The worker submits only approved requests.
4. For a refund, call `POST /v1/payments/:id/refund`; it targets the original sender and still
   requires approval. Check the final transaction and the refund journal entry.
5. Confirm `payout_attempts` contains the finalized outcome and `network_fee_records` contains the
   exact yoctoNEAR fee. Configure a dated `NEAR/USD` rate before expecting a valued Network Fees
   entry; without one Zetra raises an accounting issue rather than estimating.

If a submission fails before finality, the request remains auditable as `failed` and can be reviewed
and re-approved after the signer or network issue is corrected; the worker never silently retries a
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

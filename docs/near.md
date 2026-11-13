# NEAR payment integration

Zetra's current payment path is a direct NEP-141 transfer on `near:testnet` or `near:mainnet` when the
operator enables that network. Each invoice fixes the token contract, merchant receiving account,
base-unit amount and memo `zetra:<invoice token>`. Zetra recognizes only the USDC contract configured
for that network; a different token with the same symbol is not interchangeable.

## Checkout

The hosted page can connect a NEAR wallet and prepare `ft_transfer` on the configured USDC contract.
It checks the payer's token and NEAR balances, and registers the payer and merchant token accounts in
the same transaction when needed. The payer does not need to register the wallet with Zetra. The
checkout also shows manual-transfer details, and the merchant receives funds directly; Zetra never
holds funds or signing credentials.

After a connected wallet returns a transaction hash, the checkout immediately asks the API to verify
the finalized transaction and ingest its NEP-141 transfer. Temporary RPC failures trigger bounded
retries and preserve the payer account plus transaction hash in the browser for recovery. The payer
can retry verification or paste a transaction hash; neither path signs or sends a second transfer.

## Ingestion evidence

The worker reads fully hydrated finalized blocks from the FastNear NEAR Data API. It accepts an event
only when all of the following are true:

- the event is a successful NEP-141 `ft_transfer` log;
- the emitting contract is the configured token contract;
- the receiver is a monitored merchant account;
- the block is finalized;
- the event identity has not already been stored.

The payment record retains block height/hash, transaction hash, outcome and transfer indexes,
contract, sender, receiver, amount, timestamp, memo and the raw event log. Cursors advance only after
successful processing. When a requested height has no block, the worker skips it only if a later
finalized header proves the missing height was skipped and links to the previously processed block.
Anonymous requests are paced and retry `429` responses; sustained operation should set
`FASTNEAR_API_KEY`.

## Matching

The strongest reference is the invoice memo. Sender addresses, exact remaining amount and invoice
timing are supporting evidence. Zetra refuses to guess: uncertain, partial, overpaid, duplicate,
late or unsupported receipts enter a review workflow with their evidence and an audit trail.

## NEAR Intents

NEAR Intents and 1Click are not integrated today. The [official 1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart)
states that there is no testnet version, so Zetra does not claim a testnet route or cross-chain
support. A future integration would need verifiable finalized settlement evidence before entering
the same matching and accounting pipeline as direct NEAR receipts.

## Current proof level

Parsing, ingestion, idempotency, matching and accounting are covered by automated tests. Those tests
do not prove a particular hosted deployment's transaction. To verify a real testnet payment, inspect
the transaction and finalized token event alongside the resulting payment record, invoice allocation
and journal entry. Follow [the testnet runbook](testnet-runbook.md).

## Outgoing transfers and fees

Refunds and approved vendor bill payments are signed in the business's connected NEAR wallet. Zetra
does not sign these transfers or hold the wallet key. Refunds return funds to the original payer;
vendor payments require an approved bill and a NEAR address saved on that vendor's record. A vendor
payment is linked to the bill and creates a balanced journal entry only after Zetra verifies the
exact transfer in a finalized transaction. The sender, token contract, destination, amount, memo and
transaction actions must match the payout request. Refunds are limited cumulatively to the original
payment and cannot be redirected to another account. Submitted hashes are persisted and can be
re-verified without sending a second transfer.

If the vendor does not yet have a token account on the configured NEP-141 contract, the payer can
include the contract's minimum `storage_deposit` and the `ft_transfer` in one wallet-signed
transaction. Zetra checks both actions and records the deposit separately from the bill payment.
Final NEAR gas and storage collateral are retained in yoctoNEAR. A dated `NEAR/USD` rate (or the
explicit `NEAR_FEE_USD_RATE` fallback) is required to post their USD value; without one, Zetra raises
an accounting issue instead of inventing a valuation.

An optional worker-signed payout path remains available for other approved payout requests. It uses
`NEAR_TESTNET_PAYOUT_SIGNER_ID` and `NEAR_TESTNET_PAYOUT_PRIVATE_KEY` from the deployment secret
manager only; the signer account must match the configured Zetra payout wallet. This is an
operator-configured business signer, not a payer key; the direct wallet-signed collection, refund
and vendor flows do not require it.

Every finalized attempt records `tokens_burnt` as the exact yoctoNEAR fee. A dated `NEAR/USD` row in
`fx_rates` (or the explicit `NEAR_FEE_USD_RATE` fallback) is required before Zetra posts a valued
Network Fees entry; otherwise the fee remains unvalued and an accounting issue is raised.

## Vendor bill payment review

1. Approve a bill for a vendor with a saved receiving address on the same NEAR network.
2. In the bill, select the business wallet that holds the configured USDC and connect that same
   wallet. Zetra checks the exact token balance, wallet registration, vendor registration and NEAR
   reserve before opening the wallet confirmation.
3. Review the destination, amount, memo and any one-time token-account storage deposit in the wallet.
4. Zetra records the transaction hash, waits for finality, verifies the NEP-141 event and only then
   records a bill payment and posts Dr Accounts Payable / Cr the selected USDC wallet.
5. Review the payment, finalized transaction and separate network/setup costs from the bill and
   ledger. A missing valuation remains a visible accounting issue; it does not change the USDC bill
   payment amount.

This is a NEAR-only stablecoin vendor payout, not a fiat bank payout, payroll service, FX conversion,
or cross-chain settlement. NEAR Intents and 1Click are not live integrations.

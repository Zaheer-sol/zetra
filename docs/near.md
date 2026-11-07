# NEAR payment integration

Zetra's current payment path is a direct NEP-141 transfer on `near:testnet` or `near:mainnet` when the
operator enables that network. Each invoice fixes the token contract, merchant receiving account,
base-unit amount and memo `zetra:<invoice token>`.

## Checkout

The hosted page can connect a NEAR wallet and prepare `ft_transfer` on the configured USDC contract.
It also shows manual-transfer details. The merchant receives funds directly; Zetra never holds funds
or signing credentials.

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

NEAR Intents and 1Click are not integrated today. They could later route a payer's other chain/token
into USDC on the merchant's NEAR account. That would be an additional checkout/settlement source;
the same finalized receipt, matching and accounting pipeline should remain the system of record.

## Current proof level

Parsing, ingestion, idempotency, matching and accounting are covered by automated tests. The
repository does not yet claim a funded end-to-end testnet transfer. Follow
[the testnet runbook](testnet-runbook.md) before making that claim.

## Outgoing transfers and fees

Approved payouts and refunds use a dedicated runtime signer through `near-api-js`, call the
configured NEP-141 contract with the required 1 yoctoNEAR deposit, and wait for `FINAL`. The worker
stores the transaction/outcome evidence and retries failed attempts without storing the key. Set
`NEAR_TESTNET_PAYOUT_SIGNER_ID` and `NEAR_TESTNET_PAYOUT_PRIVATE_KEY` only in the deployment secret
manager; the signer account must match the configured Zetra wallet.

Every finalized attempt records `tokens_burnt` as the exact yoctoNEAR fee. A dated `NEAR/USD` row in
`fx_rates` (or the explicit `NEAR_FEE_USD_RATE` fallback) is required before Zetra posts a valued
Network Fees entry; otherwise the fee remains unvalued and an accounting issue is raised.

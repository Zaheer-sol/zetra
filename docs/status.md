# Implementation status

## Implemented and automated-test verified

- NEAR-only network and asset configuration.
- Hosted direct NEP-141 checkout and manual payment instructions.
- Finalized hydrated-block ingestion through the FastNear NEAR Data API.
- Token-contract and receiving-account filtering with stored chain provenance.
- Idempotent observation, settlement, matching, exception, event and webhook processing.
- Invoice, payment, receivable, payable and general-ledger workflows.
- Trial balance, profit and loss, balance sheet, cash flow and aging reports.
- Deterministic demo seed and accounting proof (`npm run demo:verify`).
- Native Rust books-attestation contract tests and WASM build; deployed on NEAR testnet at
  `zetra-books-electron.testnet` in transaction
  [`FVxHsUkb8VJuGDC6xn82cXCw4MDCVbWzuEi3WHCREwwS`](https://explorer.testnet.near.org/transactions/FVxHsUkb8VJuGDC6xn82cXCw4MDCVbWzuEi3WHCREwwS).
- Canonical payment-event schema and adapter boundary for processor sources; direct NEAR remains the
  chain settlement path while Stripe uses the processor clearing path below.
- Provider-neutral payment-source registry and signed canonical-event ingress. Events are retained
  idempotently, and only events carrying valid NEAR settlement proof can enter the real matching and
  accounting pipeline.
- Exception queue summary metrics (open value, ageing and resolution throughput) in the API and
  console.
- Payment inbox summary metrics for received, applied, needs-review and confirming funds.
- Stripe Checkout creation and signed Stripe webhook ingestion for USD receipts. Stripe receipts are
  stored as immutable processor evidence, allocated to Zetra invoices and posted through a clearing
  account before application; Checkout and PaymentIntent webhook duplicates are database-deduplicated.
- Approval-gated outgoing NEAR NEP-141 transfers and refunds, with idempotent requests and final
  transaction evidence. Interrupted submissions require chain inspection before an operator retries
  them; the worker never risks an automatic duplicate payment. Signing keys stay outside the
  database and source tree.
- Exact NEAR gas evidence from finalized transfer outcomes. Gas is posted to Network Fees only when
  a dated NEAR/USD valuation (or the explicit `NEAR_FEE_USD_RATE` fallback) exists; otherwise an
  accounting issue is raised instead of inventing a value.
- Attestation deployment automation using the current NEAR CLI keychain flow.
- Idempotent accounting repair (`POST /v1/accounting/repair`) and health checks that include
  processor clearing/application entries.
- Deterministic Proof-of-Close packages with SHA-256 verification, optional NEAR attestation and
  an accountant-facing close panel.
- Payment and invoice evidence graphs linking payment requests, stored NEAR/simulation evidence,
  matching decisions, reconciliation allocations and posted journal entries.
- Labelled reconciliation stress scenarios covering partials, overpayments, duplicates, wrong
  evidence, late receipts, split payments and reversals; every scenario is explicitly simulated.

## Prepared but not yet proven by a funded network transaction

- The testnet watcher and checkout configuration.
- The full payer-wallet → finalized NEP-141 event → invoice → accounting demonstration.

The repository makes no claim that this funded run has occurred. Follow
[the testnet runbook](testnet-runbook.md) when the operator is ready.

## Still requires operator/external proof

- NEAR Intents / 1Click routing.
- A funded testnet run with a real Stripe webhook and a real outgoing NEAR transfer. The code path
  is implemented, but it cannot be truthfully called live until the operator supplies runtime
  secrets, funds a dedicated signer wallet and executes the run.
- Independent external audit of the deployed attestation contract.

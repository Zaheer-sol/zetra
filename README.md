# Zetra

Zetra turns finalized NEAR stablecoin receipts into reconciled invoices and balanced accounting
records. A business keeps custody of its wallet; Zetra observes supported NEP-141 transfers, matches
them conservatively, and sends uncertain receipts to review instead of guessing.

Zetra is intended for the **Real-World Money** track of the 2026 NEAR Hackathon.

## What works now

| Capability | Status | How to verify |
| --- | --- | --- |
| Direct NEP-141 payment instructions and wallet checkout | Implemented | Open any seeded invoice and its hosted payment page |
| Finalized NEAR transfer ingestion | Implemented | Unit and integration tests in `npm run verify`; live use requires network configuration |
| Deterministic invoice matching and review queue | Implemented | Seeded exact and unidentified payment examples |
| Double-entry payment accounting | Implemented | `npm run demo:verify` |
| Trial balance, P&L, balance sheet, cash flow and aging | Implemented | Dashboard and `npm run demo:verify` |
| Accountant CSV exports | Implemented | Books → Export, or the verification command |
| NEAR books-attestation contract | Implemented and tested, not deployed | `npm run test:contracts:near` |
| Stripe Checkout and signed receipt reconciliation | Implemented; requires Stripe runtime secrets | `POST /v1/invoices/:id/stripe-checkout` and Stripe webhook route |
| Approval-gated outgoing NEAR transfers and refunds | Implemented; requires a funded dedicated signer | `POST /v1/payouts` then approve, or `POST /v1/payments/:id/refund` |
| NEAR gas-fee evidence and accounting | Implemented; requires a NEAR/USD valuation | `network_fee_records` and Network Fees journal entries |
| Attestation deployment automation | Implemented; not deployed here | `ZETRA_ATTESTATION_ACCOUNT=... npm run contracts:deploy:near` |
| Proof-of-Close packages and verification | Implemented; contract publication remains optional | Books → closed period → Proof of Close, or `/v1/accounting/close-packages/*` |
| Payment/invoice evidence graph | Implemented | `/v1/payments/:id/evidence` and `/v1/invoices/:id/evidence` |
| Reconciliation stress scenarios | Implemented in test mode | Developers → Test payments, or `/v1/test/scenarios` |
| A funded end-to-end testnet payment | Requires operator run | See `docs/testnet-runbook.md` |
| NEAR Intents / 1Click routing | Not integrated | Direct NEP-141 is the current payment path |

No deployed contract address or historical transaction is claimed in this repository.

### Proof of Close

After a period is closed, Zetra can build a deterministic close package containing the posted
journal entry IDs and hashes, payment evidence IDs, report totals and export metadata. The package
is canonicalized and hashed with SHA-256; timestamps and secrets are excluded. Previewing and
verifying a package never submits a transaction. Attestation only submits when the deployment has
an explicitly configured contract, signer and private key, and the returned NEAR transaction is
stored verbatim.

```bash
curl -H "Authorization: Bearer sk_test_…" \
  "http://localhost:4000/v1/accounting/close-packages/preview?month=2026-10"
```

Test-mode stress scenarios are deliberately labelled `Simulation — no on-chain transaction.`
They exercise the same observation, matching, exception, reconciliation and accounting pipeline as
real evidence.

## Run the judge demo

Prerequisites: Node.js 22+, npm, Docker with Compose, and Rust with the
`wasm32-unknown-unknown` target.

```bash
npm install
npm run judge:setup
npm run dev
```

`judge:setup` creates local configuration, starts PostgreSQL, resets the local `zetra` database,
inserts a deterministic demo business, and verifies its accounting. Run it only against a
disposable local database; it never creates a wallet, signs a transaction, deploys a contract, or
moves funds.

Open [http://localhost:3000/login](http://localhost:3000/login) and sign in with:

```text
Email: demo@zetra.local
Password: Zetra-Demo-2026!
```

Then perform these checks:

1. Open **Dashboard**. See two reconciled payments, one open invoice, and a books-health summary.
2. Open **Payments**. See two matched simulated payments and one clearly labelled unidentified
   `$740.00` receipt that remains outside revenue.
3. Open invoice `DEMO-001`. Follow its hosted payment link and inspect the NEAR account, USDC amount,
   and invoice memo shown to the payer.
4. Open **Books → Reports → Trial balance**. Debits and credits both total `$6,730.00`.
5. Open **Books → Reports → Receivables aging**. The `$1,550.00` subledger total agrees with the
   Accounts Receivable control account.

The demo payments are simulations sent through the same observation, settlement, matching,
exception, event, webhook and accounting pipeline as configured NEAR receipts. They are visibly
labelled and are not represented as on-chain transactions.

## Verify the repository

After `npm run judge:setup`:

```bash
# Fast proof of the seeded business and its books
npm run demo:verify

# Full repository proof: types, unit tests, integration tests, contract tests/WASM and production builds
npm run verify

# Run both
npm run judge:verify
```

The accounting proof fails unless all of these agree:

- three demo invoices: `$2,400.00`, `$2,040.00`, and `$1,550.00`;
- two settled simulated payments matched exactly once;
- `$1,550.00` of open receivables tied to the ledger;
- `$740.00` of unidentified money held as a liability, not revenue;
- `$5,180.00` closing wallet cash;
- `$5,990.00` accrual revenue and current earnings;
- a balanced `$6,730.00` trial balance and balance sheet;
- cash-flow categories tied to the change in cash;
- an accountant CSV generated from the same posted ledger.

## How NEAR fits

The hosted payment page prepares a standard NEP-141 `ft_transfer` to the merchant's own NEAR
account with the memo `zetra:<invoice token>`. The worker reads hydrated finalized blocks from the
FastNear NEAR Data API, accepts only configured token contracts and monitored receiving accounts,
and retains block, transaction and outcome evidence. Database uniqueness constraints make a replay
idempotent.

Payment collection does not require a custom contract. The Rust contract under
`contracts/near/books-attestation` is optional: it stores merchant-controlled hashes of exported
books so an export can later be independently compared with an on-chain attestation.

NEAR Intents is a possible later payment-routing layer for customers paying from other chains or
tokens. It is deliberately not claimed as part of the current implementation.

## Repository map

- `frontend/` — Next.js marketing site, console and hosted payment page
- `backend/src/` — Fastify API
- `backend/worker/` — finalized-block ingestion and webhook delivery
- `backend/packages/engine/` — matching, reconciliation and accounting rules
- `backend/packages/blockchain/` — NEAR data/RPC parsing and transfer verification
- `backend/packages/database/` — PostgreSQL schema, row-level security and migrations
- `contracts/near/` — optional native NEAR Rust contract
- `docs/` — architecture, accounting rules, security and testnet runbook

## Current boundaries

- The live paths are implemented but cannot be called live until the operator configures Stripe,
  funds a dedicated NEAR signer and runs the testnet proof.
- The attestation contract is tested and deployable; no public deployment or external audit is
  claimed until an operator supplies the account and a third party completes the audit.
- Anonymous FastNear access is paced and retried; sustained deployments should configure
  `FASTNEAR_API_KEY`.
- The application rate limiter is process-local; a multi-instance production deployment needs a
  shared rate-limit store.

Read [the architecture](docs/architecture.md), [accounting rules](docs/accounting.md),
[NEAR integration](docs/near.md), [verification guide](docs/verification.md), and
[testnet runbook](docs/testnet-runbook.md).

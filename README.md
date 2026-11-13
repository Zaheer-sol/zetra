# Zetra

Zetra is an audit-grade, non-custodial stablecoin subledger for NEAR. It observes finalized
NEP-141 transfers sent directly to a business account, reconciles them against invoices, and posts
balanced accounting entries without taking custody of funds or storing customer private keys.

## How it works

```text
Customer wallet
    │ NEP-141 ft_transfer
    ▼
Business-owned NEAR account
    │ finalized block evidence
    ▼
Zetra ingestion → matching/review → invoice allocation → journal entries → reports and exports
```

The hosted checkout prepares the transfer in the customer's NEAR wallet. The worker then reads
finalized NEAR data, accepts only configured token contracts and monitored receiving accounts, and
stores the transaction, block, receipt and transfer evidence. Deterministic rules either reconcile
the payment or create a review exception; uncertain payments are never silently matched.

## Current capabilities

| Capability | Status |
| --- | --- |
| Direct NEAR USDC invoice collection | Implemented with wallet signing, readiness checks, finality verification and recovery; requires an enabled network and a funded payer wallet |
| Finalized NEP-141 transfer ingestion | Implemented; runtime monitoring requires network and worker configuration |
| Exact, partial, split, overpaid, duplicate and exception handling | Implemented |
| Double-entry payment accounting | Implemented |
| Trial balance, P&L, balance sheet, cash flow and aging reports | Implemented |
| Accountant CSV exports | Implemented |
| Payment and invoice evidence timelines | Implemented |
| Deterministic period-close packages and local verification | Implemented |
| Optional NEAR books-attestation contract | Deployed to NEAR testnet; not externally audited |
| Stripe Checkout and successful-receipt reconciliation | Implemented; requires Stripe secrets |
| Wallet-signed NEAR USDC refunds | Implemented; only the original payer can receive the refund, the business wallet signs, and finality plus exact actions are verified before accounting |
| Wallet-signed NEAR USDC vendor bill payments | Implemented; vendor address, bill, token, amount, memo, optional recipient registration and finalized evidence are checked before posting |
| NEAR gas and vendor token-account setup accounting | Final network costs are recorded; USD valuation requires a configured NEAR/USD rate |
| NEAR Intents / 1Click routing | Not integrated; NEAR's 1Click quickstart currently states there is no testnet version |
| NEAR meta-transaction relayer | Not integrated; direct wallet signing is the supported payment path |
| Fiat bank settlement, virtual bank accounts, payroll tax and remittance certificates | Not integrated |

Zetra currently supports the configured USDC contract on enabled NEAR networks. Vendor bill payments
use a saved vendor NEAR address and the business's own USDC wallet. If that recipient has not
registered with the token contract, the payer wallet can include the contract's minimum storage
deposit in the same transaction; that NEAR cost is recorded separately from the USDC payable. Its
USD value is posted only when a dated NEAR/USD rate is configured; otherwise it remains an unvalued
accounting issue with its exact yoctoNEAR amount preserved.

The books-attestation contract is deployed at `zetra-books-electron.testnet`. Deployment transaction:
[`FVxHsUkb8VJuGDC6xn82cXCw4MDCVbWzuEi3WHCREwwS`](https://explorer.testnet.near.org/transactions/FVxHsUkb8VJuGDC6xn82cXCw4MDCVbWzuEi3WHCREwwS).
This transaction proves the attestation contract deployment only. Merchant payment proof is separate:
inspect the payment's stored NEAR transaction, finalized block, token event and accounting entry. The
local test suite does not establish that any particular hosted deployment has processed a payment.
Test-mode payments are always labelled as simulations.

### Important operational boundaries

- Stripe success receipts post through a processor-clearing account. Stripe refund and dispute events
  are retained, but their accounting reversal workflow is not yet complete. NEAR wallet-signed refunds
  are a separate supported flow described above.
- A customer does not need to add their payer wallet to Zetra. Hosted checkout accepts a connected
  NEAR testnet wallet, checks its USDC and NEAR balances, and includes any required NEP-141
  token-account registration in the wallet-signed payment. A payer still needs an existing NEAR
  account, testnet NEAR for gas/storage, and the configured test USDC.
- Refund and vendor wallet submissions keep their transaction hash for safe re-verification after a
  page reload. An interrupted transfer is never sent a second time automatically.
- Vendor payments are wallet-signed and bill-linked. The API checks that the sender wallet, saved
  vendor address, token, amount, memo, and finalized transfer match before clearing Accounts Payable.
- Local-bank settlement, virtual bank accounts, fiat FX, payroll to bank accounts, and remittance or
  tax certificates are not integrated. They require licensed payout partners, business onboarding,
  and jurisdiction-specific compliance; they are not represented as live Zetra features.
- NEAR Intents/1Click cannot be tested through the current 1Click test environment; cross-chain
  routing is not claimed. See the [official 1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart).
- The attestation contract is optional and has not been externally audited.
- The application rate limiter is process-local; multi-instance production deployments need a
  shared rate-limit store.

## Run locally

### Prerequisites

- Node.js 22 or newer
- npm
- Docker with Compose
- Rust with the `wasm32-unknown-unknown` target for contract builds

Install dependencies and prepare a disposable local database:

```bash
npm install
npm run setup:local
npm run dev
```

`setup:local` creates `.env` when it does not exist, starts PostgreSQL, resets the local `zetra`
database, applies migrations, seeds the deterministic demo workspace, and verifies its accounting.
It never creates a wallet, signs a transaction, deploys a contract, or moves funds.

Open [http://localhost:3000/login](http://localhost:3000/login) and sign in with the **local demo account**:

```text
Email: demo@zetra.local
Password: Zetra-Demo-2026!
```

The demo account opens its preloaded Zetra Demo workspace. Its sample records and simulated payments
stay with that account; simulations do not move funds. There is no workspace mode switch. Signing up
with your own email creates a separate, empty Live workspace and never receives demo invoices or
payments.

The API runs on [http://localhost:4000](http://localhost:4000).

## Deploy on Railway

Zetra runs as separate web, API, worker, and PostgreSQL services. See the
[Railway deployment guide](docs/railway-deployment.md) for service Dockerfiles, commands, required
variables, and private networking. The local demo credentials above are not production credentials.
Testnet payments use Circle’s NEAR Testnet USDC contract (`3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`). Claim from Circle’s faucet with NEAR Testnet selected. A deployed URL alone does not confirm a testnet payment has been submitted or reconciled.

## Verify the implementation

After `npm run setup:local`:

```bash
# TypeScript, unit tests, integration tests, contract tests, WASM build and production build
npm run verify

# Deterministic seeded accounting proof
npm run demo:verify

# Run both
npm run verify:all
```

The seeded accounting proof checks that:

- `DEMO-001` and `DEMO-002` are fully reconciled;
- `DEMO-003` remains an open `$1,550.00` receivable;
- two simulated payments are matched exactly once;
- `$740.00` of unidentified money remains a review liability rather than revenue;
- Accounts Receivable agrees with the receivables subledger;
- trial-balance debits and credits both equal `$6,730.00`;
- the balance sheet balances and cash flow reconciles;
- accountant CSV output is generated from the posted ledger.

## Accounting model

For accrual books, issuing an invoice records Accounts Receivable and revenue. A finalized supported
receipt first debits the business wallet account and credits Payments to Identify. A safe match then
debits Payments to Identify and credits Accounts Receivable. Unidentified money therefore remains a
visible liability until reviewed.

Reports aggregate posted journal lines; they do not maintain a second set of totals. Posting rejects
unbalanced entries, and corrections create reversing entries rather than rewriting posted history.

See [the accounting rules](docs/accounting.md) for the complete posting model.

## Evidence and security

- Source observations have a unique chain identity, making replays idempotent.
- Transaction, block, receipt and NEP-141 event evidence is retained for on-chain payments.
- Simulated payments explicitly say `Simulation — no on-chain transaction.`
- PostgreSQL row-level security enforces tenant isolation beneath the API.
- Financial evidence, allocations, attempts and audit records are protected by append-only database
  triggers.
- Runtime signer keys are read from environment variables and are never persisted by Zetra.
- AI may explain discrepancies or propose actions, but deterministic validation and human
  authorization remain authoritative.

Read [the security model](docs/security.md) and [architecture](docs/architecture.md) for details.

## NEAR integration

The hosted payment page prepares a standard `ft_transfer` to the merchant's own account with a memo
of the form `zetra:<invoice token>`. The ingestion worker reads hydrated finalized blocks through the
FastNear NEAR Data API and filters them against the configured token contracts and monitored
accounts.

Vendor payments also use the NEP-141 `ft_transfer` standard, initiated and signed in the business's
wallet. Zetra can include the token contract's `storage_deposit` call if the vendor account needs
registration. A finalized matching transfer creates a balanced bill-payment entry (debit Accounts
Payable, credit the selected USDC wallet); a failed or unverified transaction never clears the bill.
These flows do not need a custom payment contract, but the business must have a funded NEAR wallet
and USDC on the enabled network.

Payment collection does not require a custom contract. The optional Rust contract in
`contracts/near/books-attestation` stores a merchant-controlled SHA-256 hash for a closed set of
books so an exported package can later be compared with an on-chain attestation.

For a funded network run, follow [the testnet runbook](docs/testnet-runbook.md). Do not add a
transaction hash or deployment address to documentation until the transaction or deployment has
actually occurred.

## Repository structure

```text
frontend/                         Next.js site, console and hosted checkout
backend/src/                      Fastify API
backend/worker/                   NEAR ingestion and background processing
backend/packages/engine/          Reconciliation and accounting rules
backend/packages/blockchain/      NEAR data parsing, RPC and transfer helpers
backend/packages/database/        PostgreSQL migrations and row-level security
contracts/near/books-attestation/ Optional native NEAR Rust contract
scripts/                          Local setup, verification and operational utilities
docs/                             Architecture, accounting, security and runbooks
```

## Documentation

- [Architecture](docs/architecture.md)
- [Accounting rules](docs/accounting.md)
- [NEAR integration](docs/near.md)
- [Payment-source adapters](docs/payment-sources.md)
- [Verification](docs/verification.md)
- [Testnet runbook](docs/testnet-runbook.md)
- [Attestation deployment](docs/attestation-deployment.md)
- [Railway deployment](docs/railway-deployment.md)

## License

See [LICENSE](LICENSE).

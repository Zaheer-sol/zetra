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
| Direct NEP-141 payment instructions and wallet checkout | Implemented |
| Finalized NEAR transfer ingestion | Implemented; live use requires network configuration |
| Exact, partial, split, overpaid, duplicate and exception handling | Implemented |
| Double-entry payment accounting | Implemented |
| Trial balance, P&L, balance sheet, cash flow and aging reports | Implemented |
| Accountant CSV exports | Implemented |
| Payment and invoice evidence timelines | Implemented |
| Deterministic period-close packages and local verification | Implemented |
| Optional NEAR books-attestation contract | Deployed to NEAR testnet; not externally audited |
| Stripe Checkout and successful-receipt reconciliation | Implemented; requires Stripe secrets |
| Approval-gated outgoing NEAR transfers and refunds | Implemented; requires a funded dedicated signer |
| NEAR gas evidence and accounting | Implemented when a NEAR/USD valuation is available |
| NEAR Intents / 1Click routing | Not integrated |

The books-attestation contract is deployed at `zetra-books-electron.testnet`. Deployment transaction:
[`FVxHsUkb8VJuGDC6xn82cXCw4MDCVbWzuEi3WHCREwwS`](https://explorer.testnet.near.org/transactions/FVxHsUkb8VJuGDC6xn82cXCw4MDCVbWzuEi3WHCREwwS).
This proves contract deployment only; it does not claim a funded merchant payment has been
reconciled on testnet. Test-mode payments are always labelled as simulations.

### Important operational boundaries

- Stripe success receipts post through a processor-clearing account. Refund and dispute events are
  retained, but their accounting reversal workflow is not yet complete.
- Outgoing transfers wait for NEAR finality. An interrupted submission is not automatically retried,
  because doing so without first checking the chain could pay the recipient twice.
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

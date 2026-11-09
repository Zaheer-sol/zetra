# Verification

Run these commands from the repository root. Generated output and local builds are not evidence of
a network deployment.

## Clean evaluator path

```bash
npm install
npm run setup:local
npm run dev
```

`setup:local` starts PostgreSQL, resets only the local `zetra` development database, applies every
migration, seeds the deterministic demo, and runs the accounting proof. An existing `.env` is never
overwritten.

## Accounting proof

```bash
npm run demo:verify
```

Expected final line:

```text
Accounting verification passed: payments, invoices, subledgers and financial statements agree.
```

This command signs into the demo through the real authentication route and verifies invoice status,
payment matching, automatic entries, trial balance, Accounts Receivable, accrual revenue, balance
sheet, cash flow, unidentified-money treatment and CSV output through the API.

## Complete repository proof

```bash
npm run verify
```

It runs, in order:

1. TypeScript typechecking across every workspace.
2. Unit tests.
3. PostgreSQL integration tests against the dedicated `zetra_test` database.
4. Native NEAR Rust contract tests.
5. The contract WASM release build.
6. API, worker and web production builds.

Use `npm run verify:all` to run both the repository proof and seeded accounting proof.

## Manual browser walkthrough

Follow [the demo walkthrough](demo-walkthrough.md) after starting the stack. The automated suite
does not currently include browser end-to-end tests, so the hosted checkout and visual pages still
need manual review. The accounting assertions run against the real API and database, not mock data.

## Network verification

A local simulation is not a chain transaction. Do not claim live or testnet completion until every
step in [the funded testnet runbook](testnet-runbook.md) has been executed and its public transaction
evidence reviewed.

## Close-package verification

1. Close the accounting period only after the Books readiness checks pass.
2. Preview the package and record its SHA-256 hash.
3. Create the package, then use Verify to recompute the hash from the stored or exported artifact.
4. Attest only after an operator has deployed the optional contract and configured a dedicated
   signer. A missing deployment is never represented as a successful transaction.

The evidence graph is available at `/v1/payments/:id/evidence` and `/v1/invoices/:id/evidence`.
It distinguishes real NEAR transaction/block references from simulations and links the matching
decision, allocations and posted journal entries.

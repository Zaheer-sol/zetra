# Zetra

Live application: [zetra-web-production.up.railway.app](https://zetra-web-production.up.railway.app/)

Zetra is a NEAR stablecoin receivables, payables and accounting application. It monitors business-owned
NEAR accounts for supported finalized NEP-141 transfers, matches receipts to invoices, records
uncertain receipts for review, and posts balanced journal entries.

## Problem

Businesses can see a token transfer in a wallet or block explorer, but still have to determine which
invoice it pays, whether the amount is partial or excessive, and how it should be recorded in their
books. Wallet activity alone does not provide an invoice reconciliation or accounting record.

## Product and NEAR integration

Zetra connects an invoice to a business-owned NEAR receiving account. A customer pays from their own
NEAR wallet using a standard NEP-141 `ft_transfer` with the invoice reference in the memo. Zetra
checks finalized chain evidence, applies deterministic matching rules, and records a payment and its
accounting entries. Ambiguous payments go to a review queue instead of being silently assigned.

```text
Invoice → customer wallet → NEP-141 transfer → business NEAR account
        → finalized transaction evidence → match or review → journal entries and reports
```

Zetra does not custody incoming funds or request a payer's private key. Customers sign in their own
wallet; a payer account does not need to be registered with Zetra. A NEP-141 token account may need
registration on the token contract, which checkout includes in the wallet-signed transaction when
required. The business controls its receiving account and its keys.

The Real-World Money track is `realworld`. Zetra currently covers NEAR stablecoin invoicing and
merchant collection, reconciliation, business accounting, wallet-signed refunds and vendor bill
payments. Stripe Checkout receipts can also enter the books when Stripe credentials are configured.
This is not a fiat payout or remittance product.

## Zeti AI assistant

Zeti is available in the console sidebar and through **Ask Zeti**. Ask about invoice and payment
status, open balances, payment totals or items that need review. Zeti can also prepare an invoice
payment request from plain-language instructions and ask for confirmation before creating it.

Zeti reads business facts through the same authorized API as the console. It does not invent amounts
or post accounting entries directly. The backend applies role checks, deterministic accounting rules
and audit logging to confirmed actions. An optional language model can translate an unfamiliar
message into a supported request; it sees only the message, not business records or balances.

## Implemented and not implemented

| Area | Current status |
| --- | --- |
| Zeti AI assistant | Answers questions about invoices, payments and review items using workspace records; prepares supported payment requests for user confirmation; optional language-model fallback is limited to interpreting the request |
| NEAR USDC invoice collection | Direct wallet-signed NEP-141 transfer on an enabled network; finalized transaction verification and recovery |
| Payment reconciliation | Exact, partial, split, overpaid, duplicate and ambiguous handling; payments after an invoice due date or payment-link expiry go to review |
| Business accounting | Double-entry journals, trial balance, profit and loss, balance sheet, cash flow and receivables/payables reports |
| Payment evidence | On-chain receipts retain transaction, block, token event and matching evidence; matched receipts link to invoice allocations and, after successful posting, journal entries |
| Proof-of-Close | Deterministic period artifact and SHA-256 hash, readiness checks, and local/exported package verification; on-chain publication is optional |
| NEAR refunds | Business-wallet-signed transfer back to the original payer; posting occurs after finality and action checks |
| NEAR vendor bill payments | Business-wallet-signed transfer to the vendor address saved on the vendor record and linked to an approved bill; posting occurs after finality and action checks |
| NEAR payout gas and token-account setup costs | Exact yoctoNEAR costs are retained; USD expense posting requires a dated NEAR/USD rate or explicit fallback, otherwise an accounting issue is raised |
| Stripe receipts | Successful USD Checkout receipts can be reconciled through a processor-clearing account; requires a Stripe source plus API and webhook secrets |
| NEAR Books attestation | Optional Rust contract and API integration; testnet deployment is documented; a contract deployment is not a merchant payment or a published close attestation; contract is not externally audited |
| NEAR Intents / 1Click | Not integrated. The official 1Click quickstart says there is no testnet version; cross-chain payments are not claimed. |
| NEAR meta-transaction relayer | Not implemented; customers sign direct NEAR transactions in their wallets. |
| Fiat payroll, local-bank payouts, fiat FX conversion and remittance certificates | Not implemented. |

NEAR Intents, meta transactions and stablecoins are themes listed for the track. The current testable
payment path uses NEAR stablecoins and direct NEP-141 wallet signing. Do not treat a simulation as an
on-chain transfer. See the [official 1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart)
for its testnet availability statement.

## Run locally

### Requirements

- Node.js 22 or newer
- npm
- Docker with Compose

Rust with the `wasm32-unknown-unknown` target is only needed to build the optional contract.

### Start the application

From the repository root:

```bash
npm install
npm run setup:local
npm run dev
```

`setup:local` creates `.env` if absent, starts PostgreSQL, resets the local `zetra` database, applies
migrations, seeds the demo workspace and verifies its accounting. Before the reset, it refuses URLs
that do not point to `localhost` and the expected local database names (`zetra` and `zetra_test`). It
does not create a wallet, sign a transaction, deploy a contract or move funds.

Open [http://localhost:3000/login](http://localhost:3000/login) and use the local demo account:

```text
Email: demo@zetra.local
Password: Zetra-Demo-2026!
```

The API listens on [http://localhost:4000](http://localhost:4000). The seeded Zetra Demo workspace
contains sample records. Its simulated payments do not move funds. A new signup creates a separate
Live workspace without the demo's sample records; its onboarding may add a receiving wallet.

## Try a real NEAR testnet payment

This is separate from the local demo. It requires an enabled NEAR testnet configuration, a business
receiving account, a payer account funded with NEAR for gas and any required NEP-141 token-account
registration deposit, and USDC claimed from the [official
Circle testnet faucet](https://faucet.circle.com/) with **NEAR Testnet** selected. The configured
Circle testnet token contract is `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`;
check the [official Circle contract list](https://developers.circle.com/stablecoins/usdc-contract-addresses)
before changing it. Testnet tokens have no mainnet value.

1. **Configure** the NEAR testnet RPC, monitoring start height and Circle NEAR Testnet USDC contract
   using the environment variables described in `.env.example` → **check** `/v1/health` for the
   enabled network's status and finalized block height; the Developers page also reports ingestion
   health.
2. **Add** the business's public NEAR testnet receiving account and enable USDC → **see** that address
   on the hosted payment page.
3. **Create** a test-environment customer and invoice, then open its hosted payment link → **inspect**
   the wallet request or select **Send manually** to verify the exact token contract, business
   destination, amount and invoice memo before transferring. If token-account registration is needed,
   checkout includes its one-time storage deposit in the wallet request and shows it before signing.
4. **Connect** a funded payer wallet and approve the transfer → **see** the transaction in the wallet
   and testnet explorer.
5. **Verify** the transaction hash on the payment page or follow
   [the funded testnet runbook](docs/testnet-runbook.md) → **see** the finalized payment evidence,
   invoice allocation and accounting entries. Verification retries the submitted hash; it does not
   send a second transfer.
6. **Ask Zeti** about the invoice → **see** its recorded payment status and transaction details from
   the same workspace records.

Only the recorded NEAR transaction and its stored finalized evidence demonstrate on-chain payment.
Local simulations, tests, deployment URLs and the Books-attestation deployment are not payment proof.

## Explore the seeded workspace

This local workspace is for exploring the accounting and reconciliation screens. Its sample
payments are simulations and do not create chain transactions.

1. **Sign in** at `/login` with the local demo account → **see** the seeded Zetra Demo workspace.
2. **Open** Developers → Demo scenarios and run a partial, overpayment or duplicate scenario →
   **see** the reconciliation result labelled as a simulation.
3. **Open** the resulting payment → **see** its evidence and matching decision. Applied payments link
   to invoice allocations and, after successful posting, journal entries. Uncertain payments stay in
   review until a person resolves them.
4. **Open** Books → Reports → **see** financial statements from posted journal entries, receivables
   and payables aging, and control-account tie-outs.
5. **Run** `npm run demo:verify` → **see** the seeded accounting proof in the terminal.

The proof checks that `DEMO-001` and `DEMO-002` are reconciled, `DEMO-003` remains an open `$1,550.00`
receivable, simulated receipts are applied once, `$740.00` of unidentified money remains a review
liability, Accounts Receivable ties to the subledger, trial-balance debits and credits both equal
`$6,730.00`, the balance sheet balances, cash flow reconciles, and CSV output is generated from the
same ledger.

## Verify the code

Run these commands from the repository root after `npm run setup:local`:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:contracts:near
npm run contracts:build:near
npm run build
npm run demo:verify
```

`npm run verify` runs typechecking, unit tests, PostgreSQL integration tests, NEAR contract tests,
the WASM contract build and production builds. `npm run verify:all` also runs the seeded accounting
proof.

## Accounting and security rules

- A supported finalized receipt first debits the business wallet asset and credits Payments to
  Identify. Applying it clears that holding account against Accounts Receivable in accrual books;
  cash-basis books recognize revenue (and applicable tax) when the receipt is applied.
- Trial balance, profit and loss, balance sheet and cash-flow reports aggregate posted journal lines.
  Receivables and payables aging is computed from invoices and approved bills, respectively, and
  exposes a tie-out to the corresponding control account.
- Every journal entry must balance. Corrections reverse or adjust posted entries; history is not
  rewritten.
- Chain receipts are deduplicated. Observed receipts with ambiguous matching or unsupported token
  or network evidence remain visible for review rather than being applied silently.
- Tenant access is enforced in the API and PostgreSQL row-level security.
- Refunds must go to the original payer. Outgoing transfers are not posted until finalized NEAR
  evidence and the requested transaction actions are verified.
- Zeti may explain discrepancies or suggest matches, but deterministic accounting checks and human
  authorization govern financial actions.

## Documentation

- [Architecture](docs/architecture.md)
- [Accounting rules](docs/accounting.md)
- [NEAR integration](docs/near.md)
- [Payment-source adapters](docs/payment-sources.md)
- [Security](docs/security.md)
- [Zeti assistant](docs/assistant.md)
- [Verification](docs/verification.md)
- [Demo walkthrough](docs/demo-walkthrough.md)
- [Testnet runbook](docs/testnet-runbook.md)
- [Railway deployment](docs/railway-deployment.md)
- [Books-attestation deployment](docs/attestation-deployment.md)

## Repository layout

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

## License

See [LICENSE](LICENSE).

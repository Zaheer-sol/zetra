# Architecture

Zetra is a non-custodial NEAR payment-reconciliation and accounting service.

## Payment path

1. The API records a business, its customers, public NEAR receiving accounts and invoices.
2. The hosted page prepares a standard NEP-141 `ft_transfer` directly to the merchant account. Zetra
   never receives a private key or takes custody.
3. The worker reads hydrated finalized blocks from the FastNear NEAR Data API, filters configured
   token contracts and monitored receivers, and extracts successful NEP-141 transfer events.
4. The engine stores the observation, deduplicates its chain identity, evaluates memo, sender,
   amount and timing evidence, and records either a safe match or a review exception.
5. Settlement, invoice allocation, financial events, webhook jobs and accounting entries are written
   in one PostgreSQL transaction.
6. The console, hosted page, reports and exports read those records; they do not recompute a separate
   version of the books.

The application uses only NEAR network identities: `near:testnet` and `near:mainnet`.

The provider-neutral payment-source boundary can retain signed canonical events from a future
processor, but it only enters this path when the event carries verifiable NEAR settlement evidence.
That keeps external routing and provider credentials at the edge while the observation, finality,
matching and books remain one deterministic system of record.

## Accounting path

For accrual books, issuing an invoice records Accounts Receivable and revenue. A finalized supported
receipt first debits the merchant's wallet asset account and credits Payments to Identify. A safe
invoice match then debits Payments to Identify and credits Accounts Receivable. Therefore money can
arrive without being prematurely counted as revenue, and an unidentified receipt remains visible as
a liability until a human classifies it.

See [accounting rules](accounting.md) for the complete postings and report tie-outs.

## Invariants and where they are enforced

- **No unbalanced posting:** the engine rejects journal entries whose debits and credits differ;
  database constraints reject negative journal-line sides.
- **No duplicate chain receipt:** source observations have a unique chain/event identity and each
  payment references one unique observation.
- **No silent edit of history:** posted journals, observations, payments, allocations, decisions,
  events and audit records are protected by append-only database triggers. Corrections use reversing
  entries and explicit resolutions.
- **No cross-tenant reads:** tenant tables carry organization and environment keys; PostgreSQL row-
  level security is applied beneath the API.
- **No advance past failed ingestion:** the worker cursor advances only after a block has been
  processed successfully and stored.
- **No unsafe automatic match:** ambiguity, wrong amounts, unknown senders and unsupported tokens
  produce review records rather than fabricated invoice allocations.
- **No independent report totals:** financial statements aggregate posted journal lines; receivables
  and payables reports also expose control-account tie-outs.

## Optional contract

Payment collection does not require a custom contract. `contracts/near/books-attestation` stores a
merchant-controlled hash and timestamp for an exported set of books. It is tested locally, has not
been deployed, and has not been externally audited.

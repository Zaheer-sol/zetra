# Payment source contract

Zetra keeps one reconciliation workflow for direct NEAR receipts and processor receipts.
Every adapter must normalize a source record into the `canonicalPaymentEventSchema` exported by
`@zetra/schemas` before it reaches matching or accounting.

The canonical event carries:

- a stable source identity (`kind`, provider, connection and event ID) for idempotency;
- lifecycle status (`initiated`, `detected`, `confirming`, `finalized`, `settled`, `failed`,
  `expired`, `refunded`, `disputed` or `reversed`);
- asset, network, decimal amount and optional base units;
- payer and recipient evidence;
- provider/network fees and every known transaction hash;
- occurrence, observation and finality timestamps; and
- a bounded raw record for provider-specific evidence.

The current production path is `near:mainnet` / `near:testnet` through the NEAR RPC/indexer
worker. The API now also exposes a provider-neutral connection boundary:

- `POST /v1/payment-sources` creates a connection and returns a signing secret once;
- `POST /v1/inbound/payment-sources/:id` accepts a signed canonical event;
- `GET /v1/payment-sources/:id/events` shows the retained event-processing history; and
- `POST /v1/payment-sources/:id/status` can disable a connection without deleting evidence.

Events are stored before processing. An event without NEAR chain proof is retained as `ignored` with
an explicit waiting reason; it cannot create an invoice payment or accounting entry. An event with
valid NEAR chain evidence is passed to the same observation, finality, deterministic matching and
double-entry posting pipeline used by the native watcher. Retries are keyed by
`canonicalPaymentEventKey`, so one provider event can never create a second economic effect.

Stripe is the first live processor adapter. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`,
or supply Stripe's endpoint signing secret as `webhook_secret` when creating the payment source,
then create a payment source with `provider: "stripe"`, and configure Stripe to send events to
`/v1/inbound/payment-sources/:id/stripe`. `payment_intent.succeeded` and paid Checkout events are
converted from USD cents to the configured USDC base units, stored as immutable processor receipts,
allocated to the invoice metadata reference, and posted through a Stripe clearing account. Duplicate
events are idempotent. Only USD is accepted by this first adapter; no card data is stored.

The generic signed canonical endpoint remains available for other adapters, but it still requires
finalized NEAR chain evidence before it can create a NEAR payment. Selecting and operating a real
processor still requires external provider credentials and dashboard configuration.

AI may explain or rank canonical events, but deterministic finality, matching constraints,
idempotency and journal posting remain in the engine.

## Future NEAR Intents / 1Click boundary

The events package exposes a typed `NearIntentsSettlementProof` boundary for a future connector.
It requires a finalized NEAR settlement transaction, block, token contract, sender, receiver and
amount before the canonical engine could accept the event. The boundary is interface-only today:
there is no live quote, routing or cross-chain support in this repository, and synthetic fixtures
must remain explicitly labelled.

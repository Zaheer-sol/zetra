# Zetra Assistant

Zetra lets businesses create payment requests from a single message, collect stablecoin payments, and
receive business-ready confirmations when the money arrives.

The assistant lives inside the console (**Zeti** in the sidebar, or **Ask Zeti** / ⌘K from any
page). It is an interface, not a second system: every answer and every action goes through Zetra's
regular API as the signed-in user, so it sees exactly what that user can see in the active workspace
and its configured environment. Demo records remain in the separate seeded demo workspace; new
business workspaces start with their own books. Every change is validated, idempotent and audited like
any other.

```
message → parser (typed intent) → orchestrator → Zetra API (in-process, as the user)
                                        │                  │
                                 confirmation card    customers · invoices · payments
                                 (for anything that   matching · events · exceptions
                                  creates or changes)         │
                                        ▼                     ▼
                                   cards in the console   financial events → notifications (bell)
```

## What you can ask

| You type | Zetra does |
|---|---|
| Create a $250 USDC payment request for John for website development, due Friday | Finds John, prepares the request (customer, purpose, amount, network, due date) and asks you to confirm; then creates it and returns the hosted payment link |
| Send Sarah a $500 payment request for September consulting | Same; asks only for what's missing |
| Did John pay? / Has Acme paid INV-2061? | The latest payment with customer, purpose, invoice, amount, network, status and transaction, plus what's still open |
| Show today's payments / How much did we receive in USDC this week? / How much did Acme pay this month? | Counts and totals computed by the backend (`GET /v1/payments/summary`) |
| What's outstanding? / What invoices are overdue? | Open payment requests with the outstanding total |
| Any payments needing review? / Did anyone pay the wrong amount? / Any duplicates? | The review queue, filtered |
| Find the payment for website development | Search by purpose, customer, invoice, payment id or transaction |
| Show Acme's payment history / What was our latest payment? | Payment lists and cards |
| Give me the accounting details for John's payment | An accounting-ready record of the stored facts (no tax, FX or journal entries are invented) |
| The payment from John is actually for the website project | Finds the payment and the matching open request, and asks you to confirm the move |

## Safety

- **Deterministic parsing.** The default parser extracts intent and fields without a model. An
  optional language-model fallback is constrained to the same typed intents and confirmation flow.
  Unrecognized messages get help.
- **Never guesses money.** Amounts need an explicit marker ($, USDC). Ambiguous customers produce a
  choice; missing customer, amount, purpose or stablecoin produce a question; a missing receiving
  wallet produces an explanation and a link. The stablecoin defaults only when the workspace's
  wallets accept exactly one; the network follows the selected receiving wallet.
- **Confirmation before anything is created or changed.** The confirmation is a one-time action tied
  to the user, workspace and mode; it expires after 15 minutes, can't be confirmed from another
  workspace or after switching workspace, and its id is the `Idempotency-Key` of the API call, so a
  double click creates one payment request.
- **Roles apply.** A viewer can ask questions but not create; creating customers or moving payments
  needs the corresponding role.
- **Audited.** API changes made through the assistant are recorded with the user as the actor and
  "via Zetra Assistant" as the channel (and the assistant message id as the request id); confirmations
  and cancellations are audited too. The transcript is stored per user and workspace.
- **Cards, not markup.** Replies are structured data rendered by the console; names and purposes are
  shown verbatim and can't inject anything.
- **Console only.** API keys can't use the assistant.

## Optional language model

Zeti's parser is deterministic and handles the phrasings above on its own. For messages it doesn't
understand, an optional language model can translate the message into one of the same intents. The
model sees only the message: never the books, balances or customer list. Its answer must match one of
Zeti's intent shapes exactly, amounts and names are kept only when the message itself states them, and
anything that creates a record still asks for confirmation. Without a key, or when the provider is
slow (6 seconds) or fails, Zeti answers exactly as it does without a model.

Any OpenAI-compatible chat completions API works, set on the API service:

| Variable | Default | |
|---|---|---|
| `LLM_API_KEY` | (none: model off) | The provider's API key |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | Groq's free tier by default |
| `LLM_MODEL` | `openai/gpt-oss-120b` | |

## Notifications

The bell in the top bar shows business-ready cards for payment events, and a toast appears when one
arrives while the console is open:

- **Payment received**: who paid, how much, what it was for, invoice, "Matched & confirmed", network, transaction
- **Partial payment received**: paid so far and outstanding
- **Payment requires review** (overpaid): expected, difference
- **Possible duplicate payment**: the original invoice; not applied
- **Unidentified payment detected**: customer and purpose shown as *Unknown*
- **Payment detected** (while still confirming), **reversed**, **payment moved**

Notifications *are* Zetra's financial events (`GET /v1/notifications`), so one event is one
notification and a replayed event can't notify twice. Test-mode notifications are labeled.

## API

| Endpoint | Purpose |
|---|---|
| `POST /v1/assistant/messages` | `{ text, conversation_id?, choice?, timezone? }` → reply blocks |
| `POST /v1/assistant/actions/:id` | `{ decision: "confirm" \| "cancel" }` |
| `GET /v1/assistant/conversations/latest` | Restore the last conversation |
| `GET /v1/notifications`, `POST /v1/notifications/seen` | Notification cards and unread state |
| `GET /v1/payments/summary` | Counts and totals with the payment-list filters (also used by the assistant) |

All are session-only (console) endpoints.

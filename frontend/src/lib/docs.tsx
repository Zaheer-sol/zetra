import type { ReactNode } from "react";
import { CodeBlock } from "@/components/app-ui";

export interface DocPage {
  slug: string;
  title: string;
  group: string;
  lead: string;
  body: ReactNode;
}

const Code = ({ children }: { children: string }) => <CodeBlock className="not-prose my-4" code={children.trim()} />;

export const DOCS: DocPage[] = [
  {
    slug: "quickstart",
    group: "Get started",
    title: "Quickstart",
    lead: "Create a NEAR invoice, share its payment page, and receive a matched payment event.",
    body: <><h2>1. Add a NEAR receiving account</h2><p>Add a receiving account on an enabled NEAR network and choose the NEP-141 assets it accepts.</p><h2>2. Create an invoice</h2><Code>{`POST /v1/invoices
{ "customer_id": "cus_...", "title": "Services", "amount": "25.00",
  "asset": "USDC", "network": "near:testnet" }`}</Code><h2>3. Share the payment page</h2><p>The invoice response includes a hosted payment URL. The customer can connect a NEAR wallet or follow the displayed transfer instructions and memo.</p><h2>4. Handle the result</h2><p>Zetra reads finalized NEAR outcomes. A safely matched payment updates the invoice and emits a signed webhook.</p></>
  },
  {
    slug: "near-payments",
    group: "Payments",
    title: "NEAR payments",
    lead: "Zetra monitors final NEP-141 transfers to registered NEAR accounts.",
    body: <><h2>Finality first</h2><p>Only finalized transfer outcomes enter the payment pipeline. Every observation includes the NEAR network, transaction hash, transfer index, sender, recipient, token contract, amount, and memo.</p><h2>Matching</h2><p>The hosted payment page supplies the memo <code>zetra:&lt;invoice token&gt;</code>. When a payment cannot be matched safely, it is shown in Exceptions for review.</p></>
  },
  {
    slug: "webhooks",
    group: "Developers",
    title: "Webhooks",
    lead: "Receive signed payment and business events after finalized NEAR activity is processed.",
    body: <><p>Create an endpoint under Developers → Webhooks. Verify the supplied signature before acting on a delivery.</p><Code>{`{
  "type": "payment.matched",
  "data": { "payment": { "network": "near:testnet" } }
}`}</Code></>
  },
  {
    slug: "api-reference",
    group: "Reference",
    title: "API reference",
    lead: "The API is versioned under /v1.",
    body: <><ul><li><code>POST /v1/wallets</code></li><li><code>POST /v1/invoices</code></li><li><code>GET /v1/payments</code></li><li><code>GET /v1/exceptions</code></li><li><code>GET /v1/exceptions/summary</code></li><li><code>GET /v1/reconciliation</code></li><li><code>POST /v1/payment-sources</code></li><li><code>GET /v1/payment-sources/:id/events</code></li></ul><p>Canonical sources post signed events to <code>POST /v1/inbound/payment-sources/:id</code>. Events without NEAR settlement proof are retained but cannot create accounting effects. The server exposes its complete OpenAPI description at <code>/openapi.json</code>.</p></>
  }
];

export const DOC_GROUPS = [...new Set(DOCS.map((d) => d.group))];

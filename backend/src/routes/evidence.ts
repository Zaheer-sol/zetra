import type { FastifyInstance } from "fastify";
import { explorerTx } from "@zetra/engine";
import { notFound } from "../lib/errors";
import { idParam, route } from "../lib/route";

type Row = Record<string, any>;

function evidenceNode(type: string, status: string, sourceId: string | null, at: unknown, explanation: string, extra: Record<string, unknown> = {}) {
  return { type, status, timestamp: at, source_id: sourceId, explanation, ...extra };
}

async function paymentEvidence(c: any, paymentId: string, organizationId: string, environment: string) {
  const p = (await c.query(
    `SELECT p.*, so.block_hash, so.outcome_id, so.transfer_index, so.token_address, so.confirmation_state,
            so.finalized_at, so.raw, a.symbol, a.decimals, n.name AS network_name, n.config,
            i.number AS invoice_number, i.title AS invoice_title
       FROM payments p JOIN source_observations so ON so.id = p.observation_id
       LEFT JOIN assets a ON a.id = p.asset_id LEFT JOIN network_identities n ON n.id = p.network_id
       LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.id = $1 AND p.organization_id = $2 AND p.environment = $3`,
    [paymentId, organizationId, environment]
  )).rows[0] as Row | undefined;
  if (!p) throw notFound("payment");
  const decision = (await c.query("SELECT * FROM match_decisions WHERE payment_id = $1 ORDER BY created_at DESC LIMIT 1", [paymentId])).rows[0] as Row | undefined;
  const allocations = (await c.query("SELECT id, invoice_id, amount::text AS amount, kind, created_at FROM allocations WHERE payment_id = $1 ORDER BY created_at, id", [paymentId])).rows as Row[];
  const journal = (await c.query("SELECT DISTINCT e.id, e.number, e.entry_date, e.status, e.description FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE l.payment_id = $1 ORDER BY e.entry_date, e.id", [paymentId])).rows as Row[];
  const simulated = p.source === "simulated";
  const explorer = simulated ? null : explorerTx(p.transaction_hash, false, p.network_id);
  const nodes = [
    p.invoice_id ? evidenceNode("invoice", "linked", p.invoice_id, null, `Applied to ${p.invoice_number ?? "the invoice"}.`, { invoice_number: p.invoice_number, title: p.invoice_title }) : evidenceNode("invoice", "unlinked", null, null, "No invoice is linked; the payment remains available for review."),
    evidenceNode("payment_request", p.invoice_id ? "linked" : "unlinked", p.invoice_id, p.created_at, p.invoice_id ? "Payment was received against the requested invoice." : "No payment request was linked."),
    evidenceNode("wallet", "received", p.wallet_id, p.block_timestamp, `Received by wallet ${p.to_address}.`, { wallet_id: p.wallet_id, receiver: p.to_address }),
    evidenceNode("transaction", simulated ? "simulated" : "on_chain", p.transaction_hash, p.block_timestamp, simulated ? "Simulation — no on-chain transaction." : "Transaction reference recorded from NEAR evidence.", { simulated, transaction_hash: simulated ? null : p.transaction_hash, explorer_url: explorer, sender: p.from_address, receiver: p.to_address, amount_base_units: p.amount, token_contract: p.token_address, memo: p.raw?.memo ?? null }),
    evidenceNode("finalized_block", simulated ? "simulated" : p.confirmation_state === "final" ? "finalized" : "confirming", p.block_hash, p.finalized_at ?? p.block_timestamp, simulated ? "Simulation — no finalized block." : "Block finality recorded by the NEAR ingestion boundary.", { simulated, block_number: p.block_number, block_hash: simulated ? null : p.block_hash, network: p.network_id, network_name: p.network_name }),
    evidenceNode("receipt_outcome", simulated ? "simulated" : "recorded", p.outcome_id, p.block_timestamp, simulated ? "Simulation receipt; no chain execution occurred." : "Receipt outcome is retained as immutable evidence.", { outcome_id: simulated ? null : p.outcome_id, transfer_index: p.transfer_index }),
    evidenceNode("nep141_transfer", p.asset_id ? "supported" : "unsupported", p.observation_id, p.block_timestamp, p.asset_id ? `NEP-141 ${p.symbol ?? "token"} transfer accepted by the configured asset registry.` : "Token contract is not configured, so no accounting entry is created.", { token_contract: p.token_address, asset: p.symbol ?? null, amount_base_units: p.amount, decimals: p.decimals ?? null }),
    evidenceNode("matching", decision?.outcome ?? "pending", decision?.id ?? null, decision?.created_at ?? null, decision?.explanation ?? "No matching decision has been recorded." , { rule_version: decision?.rule_version ?? null, checks: decision?.checks ?? [], candidates: decision?.candidates ?? [] }),
    evidenceNode("reconciliation", p.status, p.id, p.updated_at, p.invoice_id ? "Payment allocation is recorded against the invoice." : "Payment has not been reconciled to an invoice." , { allocation_ids: allocations.map((a) => a.id), allocations: allocations.map((a) => ({ id: a.id, invoice_id: a.invoice_id, amount: a.amount, kind: a.kind })) }),
    evidenceNode("journal_entry", journal.length ? "posted" : "not_posted", journal[0]?.id ?? null, journal[0]?.entry_date ?? null, journal.length ? "The payment is represented by posted double-entry journal entries." : "No posted journal entry is linked yet.", { entries: journal.map((j) => ({ id: j.id, number: j.number, date: j.entry_date, status: j.status, description: j.description })) }),
    evidenceNode("report_allocation", journal.length ? "included" : "pending", journal[0]?.id ?? null, journal[0]?.entry_date ?? null, journal.length ? "Posted journal lines flow into the financial reports." : "Nothing is included in reports until a journal entry is posted.")
  ];
  return { object: "evidence_graph", subject: { type: "payment", id: p.id }, simulated, nodes };
}

export function evidenceRoutes(app: FastifyInstance) {
  route(app, {
    method: "GET",
    url: "/v1/payments/:id/evidence",
    summary: "Trace a payment from request through chain evidence, matching, reconciliation and books",
    tags: ["payments"],
    permission: "read",
    params: idParam,
    handler: ({ tx, params, organizationId, environment }) => tx((c) => paymentEvidence(c, params.id, organizationId, environment))
  });
  route(app, {
    method: "GET",
    url: "/v1/invoices/:id/evidence",
    summary: "Trace every payment and accounting decision for an invoice",
    tags: ["invoices"],
    permission: "read",
    params: idParam,
    handler: ({ tx, params, organizationId, environment }) => tx(async (c) => {
      const invoice = (await c.query("SELECT id, number, title FROM invoices WHERE id = $1 AND organization_id = $2 AND environment = $3", [params.id, organizationId, environment])).rows[0];
      if (!invoice) throw notFound("invoice");
      const payments = (await c.query("SELECT id FROM payments WHERE invoice_id = $1 OR provisional_invoice_id = $1 ORDER BY created_at, id", [params.id])).rows as Row[];
      const graphs = [];
      for (const p of payments) graphs.push(await paymentEvidence(c, p.id, organizationId, environment));
      return { object: "evidence_graph", subject: { type: "invoice", id: invoice.id, number: invoice.number, title: invoice.title }, simulated: payments.length > 0 && payments.every((p) => p.source === "simulated"), payments: graphs };
    })
  });
}

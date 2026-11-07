import type { FastifyInstance } from "fastify";
import type { Client } from "@zetra/database";
import { classifyTransaction, ensureBooks, money, undoClassification } from "@zetra/engine";
import { classifyTransactionInput, reasonInput, type Environment } from "@zetra/schemas";
import { idParam, route } from "../../lib/route";

type Row = Record<string, any>;

/** Received money that still needs a human decision. */
export async function unclassified(c: Client, organizationId: string, environment: Environment) {
  await ensureBooks(c, organizationId, environment);
  const receipts = (
    await c.query(
      `SELECT p.id, p.amount, p.asset_id, p.from_address, p.transaction_hash, p.block_timestamp, p.status, a.symbol, a.decimals
         FROM payments p JOIN assets a ON a.id = p.asset_id
        WHERE p.organization_id = $1 AND p.environment = $2 AND p.status IN ('needs_review','dismissed')
          AND NOT EXISTS (SELECT 1 FROM transaction_classifications x WHERE x.payment_id = p.id AND x.reversed_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.organization_id = p.organization_id AND w.environment = p.environment AND w.network_id = p.network_id AND w.address = p.from_address)
        ORDER BY p.block_timestamp DESC LIMIT 200`,
      [organizationId, environment]
    )
  ).rows as Row[];
  const fmt = (v: string, d: number) => money(BigInt(v) * 10n ** BigInt(Math.max(0, 6 - d)) / 10n ** BigInt(Math.max(0, d - 6)));
  return {
    receipts: receipts.map((p) => ({ id: p.id, amount: fmt(p.amount, p.decimals), asset: p.symbol, from_address: p.from_address, transaction_hash: p.transaction_hash, received_at: p.block_timestamp, status: p.status, link: `/app/payments/${p.id}` }))
  };
}

/** Money Zetra couldn't explain on its own: what still needs a decision, classifying it, and undoing a classification. */
export function classificationRoutes(app: FastifyInstance) {
  route(app, {
    method: "GET",
    url: "/v1/accounting/unclassified",
    summary: "Received money that still needs to be identified or classified",
    tags: ["accounting"],
    permission: "financials:read",
    handler: ({ tx, organizationId, environment }) => tx((c) => unclassified(c, organizationId, environment))
  });

  route(app, {
    method: "POST",
    url: "/v1/accounting/classifications",
    summary: "Classify an unidentified receipt to an account",
    tags: ["accounting"],
    permission: "financials:write",
    idempotent: true,
    body: classifyTransactionInput,
    handler: async ({ tx, body, organizationId, environment, actor, reply }) => {
      const r = await tx((c) => classifyTransaction(c, organizationId, environment, body, actor));
      reply.code(201);
      return r;
    }
  });

  route(app, {
    method: "POST",
    url: "/v1/accounting/classifications/:id/undo",
    summary: "Undo a classification; the money returns to its holding account",
    tags: ["accounting"],
    permission: "financials:approve",
    params: idParam,
    body: reasonInput,
    handler: ({ tx, params, body, organizationId, environment, actor }) => tx(async (c) => (await undoClassification(c, organizationId, environment, params.id, body.reason, actor), { ok: true }))
  });
}

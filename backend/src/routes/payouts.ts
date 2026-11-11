import type { FastifyInstance } from "fastify";
import { cancelPayout, approvePayout, confirmWalletSignedRefund, createPayoutRequest, createRefundRequest, serializePayout } from "@zetra/engine";
import { createPayoutInput, payoutActionInput, payoutListQuery, refundInput, refundWalletConfirmationInput } from "@zetra/schemas";
import { idParam, route } from "../lib/route";

export function payoutRoutes(app: FastifyInstance) {
  route(app, {
    method: "GET",
    url: "/v1/payouts",
    summary: "List outgoing NEAR payouts and refunds",
    tags: ["payouts"],
    permission: "financials:read",
    query: payoutListQuery,
    handler: async ({ query, tx, organizationId, environment }) => tx(async (c) => {
      const params: unknown[] = [organizationId, environment];
      const status = query.status ? " AND status = $3" : "";
      if (query.status) params.push(query.status);
      params.push(query.limit);
      const rows = (await c.query(`SELECT * FROM payout_requests WHERE organization_id = $1 AND environment = $2${status} ORDER BY requested_at DESC LIMIT $${params.length}`, params)).rows;
      return { data: rows.map(serializePayout) };
    })
  });

  route(app, {
    method: "POST",
    url: "/v1/payouts",
    summary: "Create an approval-gated outgoing NEAR payout",
    tags: ["payouts"],
    permission: "financials:write",
    idempotent: true,
    body: createPayoutInput,
    handler: async ({ body, tx, organizationId, environment, actor, reply }) => tx(async (c) => {
      const row = await createPayoutRequest(c, organizationId, environment, {
        kind: body.kind,
        walletId: body.wallet_id,
        recipient: body.recipient,
        amount: body.amount,
        asset: body.asset,
        memo: body.memo,
        paymentId: body.payment_id,
        invoiceId: body.invoice_id,
        vendorId: body.vendor_id,
        idempotencyKey: body.idempotency_key
      }, actor);
      reply.code(201);
      return serializePayout(row);
    })
  });

  route(app, {
    method: "POST",
    url: "/v1/payouts/:id/approve",
    summary: "Approve an outgoing payout for worker submission",
    tags: ["payouts"],
    permission: "financials:approve",
    params: idParam,
    body: payoutActionInput,
    handler: async ({ params, tx, organizationId, environment, actor }) => tx(async (c) => serializePayout(await approvePayout(c, organizationId, environment, params.id, actor)))
  });

  route(app, {
    method: "POST",
    url: "/v1/payouts/:id/cancel",
    summary: "Cancel an unsubmitted payout",
    tags: ["payouts"],
    permission: "financials:approve",
    params: idParam,
    body: payoutActionInput,
    handler: async ({ params, body, tx, organizationId, environment, actor }) => tx(async (c) => serializePayout(await cancelPayout(c, organizationId, environment, params.id, body?.reason, actor)))
  });

  route(app, {
    method: "POST",
    url: "/v1/payments/:id/refund",
    summary: "Create an approval-gated refund to the original NEAR sender",
    tags: ["payouts"],
    permission: "financials:write",
    idempotent: true,
    params: idParam,
    body: refundInput,
    handler: async ({ params, body, tx, organizationId, environment, actor, reply }) => tx(async (c) => {
      const row = await createRefundRequest(c, organizationId, environment, params.id, { amount: body.amount, memo: body.memo, idempotencyKey: body.idempotency_key }, actor);
      reply.code(201);
      return serializePayout(row);
    })
  });

  route(app, {
    method: "POST",
    url: "/v1/payouts/:id/confirm-wallet",
    summary: "Verify and record a finalized refund signed by the business NEAR wallet",
    tags: ["payouts"],
    permission: "financials:approve",
    idempotent: true,
    params: idParam,
    body: refundWalletConfirmationInput,
    handler: async ({ params, body, tx, organizationId, environment, actor }) => tx(async (c) =>
      serializePayout(await confirmWalletSignedRefund(c, organizationId, environment, params.id, body.transaction_hash, actor))
    )
  });
}

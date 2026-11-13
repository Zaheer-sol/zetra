import type { FastifyInstance } from "fastify";
import { cancelPayout, approvePayout, confirmWalletSignedRefund, confirmWalletSignedVendorPayout, createPayoutRequest, createRefundRequest, preflightVendorPayout, serializePayout, submitWalletSignedPayout } from "@zetra/engine";
import { createPayoutInput, payoutActionInput, payoutListQuery, refundInput, refundWalletConfirmationInput, payoutWalletSubmissionInput, vendorPayoutPreflightInput } from "@zetra/schemas";
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
      const filters: string[] = [];
      if (query.status) { params.push(query.status); filters.push(`status = $${params.length}`); }
      if (query.bill_id) { params.push(query.bill_id); filters.push(`bill_id = $${params.length}`); }
      params.push(query.limit);
      const rows = (await c.query(`SELECT * FROM payout_requests WHERE organization_id = $1 AND environment = $2${filters.map((filter) => ` AND ${filter}`).join("")} ORDER BY requested_at DESC LIMIT $${params.length}`, params)).rows;
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
        billId: body.bill_id,
        idempotencyKey: body.idempotency_key
      }, actor);
      reply.code(201);
      return serializePayout(row);
    })
  });

  route(app, {
    method: "POST",
    url: "/v1/payouts/vendor-preflight",
    summary: "Check a wallet-signed NEAR vendor bill payment before signing",
    tags: ["payouts"],
    permission: "financials:approve",
    body: vendorPayoutPreflightInput,
    handler: async ({ body, tx, organizationId, environment }) => tx((c) => preflightVendorPayout(c, organizationId, environment, body))
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
    url: "/v1/payouts/:id/submit",
    summary: "Persist a wallet-submitted NEAR refund or vendor transaction before finality verification",
    tags: ["payouts"],
    permission: "financials:approve",
    idempotent: true,
    params: idParam,
    body: payoutWalletSubmissionInput,
    handler: async ({ params, body, tx, organizationId, environment, actor }) => tx(async (c) =>
      serializePayout(await submitWalletSignedPayout(c, organizationId, environment, params.id, body.transaction_hash, actor))
    )
  });

  route(app, {
    method: "POST",
    url: "/v1/payouts/:id/confirm-wallet",
    summary: "Verify and record a finalized wallet-signed NEAR refund or vendor payment",
    tags: ["payouts"],
    permission: "financials:approve",
    idempotent: true,
    params: idParam,
    body: refundWalletConfirmationInput,
    handler: async ({ params, body, tx, organizationId, environment, actor }) => tx(async (c) => {
      const payout = (await c.query("SELECT kind FROM payout_requests WHERE id = $1 AND organization_id = $2 AND environment = $3", [params.id, organizationId, environment])).rows[0] as { kind?: string } | undefined;
      if (payout?.kind === "vendor") return serializePayout(await confirmWalletSignedVendorPayout(c, organizationId, environment, params.id, body.transaction_hash, actor));
      return serializePayout(await confirmWalletSignedRefund(c, organizationId, environment, params.id, body.transaction_hash, actor));
    })
  });
}

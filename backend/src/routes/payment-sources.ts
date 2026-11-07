import type { FastifyInstance } from "fastify";
import { createPaymentSource, receivePaymentSourceEvent, receiveStripeWebhook, serializePaymentSource, serializePaymentSourceEvent, setPaymentSourceStatus } from "@zetra/engine";
import { createPaymentSourceInput, paymentSourceEventListQuery } from "@zetra/schemas";
import { z } from "zod";
import { notFound } from "../lib/errors";
import { idParam, route } from "../lib/route";

type Row = Record<string, any>;

/** Authenticated management endpoints for canonical payment-source connections. */
export function paymentSourceRoutes(app: FastifyInstance) {
  route(app, {
    method: "GET",
    url: "/v1/payment-sources",
    summary: "List canonical payment-source connections",
    tags: ["payment-sources"],
    permission: "read",
    handler: async ({ tx, organizationId, environment }) =>
      tx(async (c) => {
        const rows = (await c.query("SELECT * FROM payment_sources WHERE organization_id = $1 AND environment = $2 ORDER BY created_at DESC", [organizationId, environment])).rows as Row[];
        return { data: rows.map(serializePaymentSource) };
      })
  });

  route(app, {
    method: "POST",
    url: "/v1/payment-sources",
    summary: "Create a canonical payment-source connection (secret shown once)",
    tags: ["payment-sources"],
    permission: "webhooks:write",
    idempotent: true,
    body: createPaymentSourceInput,
    handler: async ({ body, tx, organizationId, environment, actor, reply }) =>
      tx(async (c) => {
        const { source, secret } = await createPaymentSource(c, organizationId, environment, { kind: body.kind, provider: body.provider, name: body.name, webhookSecret: body.webhook_secret }, actor);
        reply.code(201);
        return { ...serializePaymentSource(source), secret };
      })
  });

  route(app, {
    method: "POST",
    url: "/v1/payment-sources/:id/status",
    summary: "Enable or disable a canonical payment-source connection",
    tags: ["payment-sources"],
    permission: "webhooks:write",
    params: idParam,
    body: z.object({ status: z.enum(["active", "disabled"]) }),
    handler: async ({ params, body, tx, organizationId, actor }) => tx(async (c) => serializePaymentSource(await setPaymentSourceStatus(c, organizationId, params.id, body.status, actor)))
  });

  route(app, {
    method: "GET",
    url: "/v1/payment-sources/:id/events",
    summary: "List canonical events received by a payment source",
    tags: ["payment-sources"],
    permission: "read",
    params: idParam,
    query: paymentSourceEventListQuery,
    handler: async ({ params, query, tx, organizationId, environment }) =>
      tx(async (c) => {
        const source = (await c.query("SELECT id FROM payment_sources WHERE id = $1 AND organization_id = $2 AND environment = $3", [params.id, organizationId, environment])).rows[0];
        if (!source) throw notFound("payment source");
        const rows = (
          await c.query(
            `SELECT * FROM payment_source_events WHERE source_id = $1 AND organization_id = $2 AND environment = $3
             ORDER BY received_at DESC LIMIT $4`,
            [params.id, organizationId, environment, query.limit]
          )
        ).rows as Row[];
        return { data: rows.map(serializePaymentSourceEvent) };
      })
  });
}

/**
 * Signed ingress endpoint for adapters. It is deliberately separate from authenticated console
 * routes: the source secret is the credential, and the raw body is retained for verification.
 */
export async function inboundPaymentSourceRoutes(app: FastifyInstance) {
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 512 * 1024 }, (_request, body, done) => done(null, body));
    scope.post(
      "/v1/inbound/payment-sources/:id",
      { config: { rateLimit: { max: 600, timeWindow: "1 minute" } }, schema: { tags: ["payment-sources"], summary: "Receive a signed canonical payment event", hide: true } },
      async (request, reply) => {
        const id = String((request.params as { id?: string }).id ?? "");
        const raw = typeof request.body === "string" ? request.body : "";
        const result = await receivePaymentSourceEvent(id, request.headers as Record<string, string | string[] | undefined>, raw);
        reply.code(result.status);
        return {
          outcome: result.outcome,
          event_id: result.event_id ?? null,
          payment_id: result.payment_id ?? null,
          detail: result.detail ?? null,
          duplicate: result.duplicate ?? false
        };
      }
    );
    scope.post(
      "/v1/inbound/payment-sources/:id/stripe",
      { config: { rateLimit: { max: 600, timeWindow: "1 minute" } }, schema: { tags: ["payment-sources"], summary: "Receive a signed Stripe webhook", hide: true } },
      async (request, reply) => {
        const id = String((request.params as { id?: string }).id ?? "");
        const raw = typeof request.body === "string" ? request.body : "";
        const result = await receiveStripeWebhook(id, request.headers as Record<string, string | string[] | undefined>, raw);
        reply.code(result.status);
        return { outcome: result.outcome, event_id: result.event_id ?? null, receipt_id: result.receipt_id ?? null, detail: result.detail ?? null, duplicate: result.duplicate ?? false };
      }
    );
  });
}

import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { appEnv, loadNearNetworks } from "@zetra/config";
import { pool, withGlobal, withSystem } from "@zetra/database";
import { newId } from "@zetra/schemas";
import { REDACTED_KEYS } from "@zetra/security";
import { registerAuth } from "./lib/auth";
import { errorHandler } from "./lib/errors";
import { registerIdempotency } from "./lib/idempotency";
import { authRoutes } from "./routes/auth";
import { customerRoutes } from "./routes/customers";
import { developerRoutes } from "./routes/developers";
import { invoiceRoutes } from "./routes/invoices";
import { inboundOrderRoutes, orderRoutes } from "./routes/orders";
import { organizationRoutes } from "./routes/organization";
import { paymentRoutes } from "./routes/payments";
import { assistantRoutes } from "./routes/assistant";
import { publicRoutes } from "./routes/public";
import { reportingRoutes } from "./routes/reporting";
import { accountingRoutes } from "./routes/accounting";
import { walletRoutes } from "./routes/wallets";
import { inboundPaymentSourceRoutes, paymentSourceRoutes } from "./routes/payment-sources";
import { payoutRoutes } from "./routes/payouts";
import { evidenceRoutes } from "./routes/evidence";

export async function buildServer(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const env = appEnv();
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: { paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]', ...REDACTED_KEYS.map((k) => `body.${k}`)], censor: "[redacted]" }
          },
    genReqId: () => newId("request"),
    requestIdHeader: "x-request-id",
    trustProxy: env.TRUST_PROXY === "true" ? true : env.TRUST_PROXY === "false" ? false : env.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    ajv: { customOptions: { strict: false } }
  });

  // Validation is done with zod inside each route; JSON schemas exist for OpenAPI only.
  app.setValidatorCompiler(() => () => true);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: "not_found", message: `No route for ${request.method} ${request.url}.`, request_id: request.id } }));

  await app.register(cookie, { secret: env.sessionSecret });
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    // Limit per credential when authenticated, per IP otherwise.
    keyGenerator: (request) => {
      const auth = request.headers.authorization;
      if (auth) return `key:${auth.slice(-16)}`;
      const session = request.cookies?.zetra_session;
      return session ? `ses:${session.slice(-16)}` : `ip:${request.ip}`;
    },
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      error: { code: "rate_limited", message: `Too many requests. Retry in ${Math.ceil(context.ttl / 1000)}s.`, request_id: request.id }
    })
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Zetra API",
        version: "2026-11-01",
        description:
          "Invoices, payments and automatic books across configured networks: customers, invoices, orders, payments, matching, books, reconciliation, financial events and webhooks. Amounts are decimal strings. Test and live keys are isolated by environment."
      },
      servers: [{ url: "/", description: "This server" }],
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer", description: "Zetra API key: sk_test_… or sk_live_…" },
          session: { type: "apiKey", in: "cookie", name: "zetra_session" }
        }
      },
      tags: [
        { name: "invoices" },
        { name: "payments" },
        { name: "exceptions" },
        { name: "customers" },
        { name: "wallets" },
        { name: "reporting" },
        { name: "financial-events" },
        { name: "webhooks" },
        { name: "payment-sources" },
        { name: "payouts" },
        { name: "test-mode" },
        { name: "api-keys" },
        { name: "organization" },
        { name: "auth" },
        { name: "public" }
      ]
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs", uiConfig: { docExpansion: "list", deepLinking: true } });

  registerAuth(app);
  registerIdempotency(app);

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    return payload;
  });

  // Liveness: the process is up. Readiness: it can serve (database reachable).
  // /v1/health: whether the system is actually working (ingestion progressing, webhooks flowing).
  // Add ?strict=true for uptime monitors: any degraded check returns 503, which is an alert.
  app.get("/v1/health/live", { schema: { tags: ["organization"], summary: "Liveness probe" } }, async () => ({ status: "ok" }));
  app.get("/v1/health/ready", { schema: { tags: ["organization"], summary: "Readiness probe (database reachable)" } }, async (_request, reply) => {
    try {
      await pool().query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable", checks: { database: "unavailable" } });
    }
  });
  app.get("/v1/health", { schema: { tags: ["organization"], summary: "System health: database, ingestion per network, webhook delivery" } }, async (request, reply) => {
    const strict = ["1", "true"].includes(String((request.query as Record<string, string>)?.strict ?? ""));
    const checks: Record<string, unknown> = {};
    const problems: string[] = [];
    try {
      await pool().query("SELECT 1");
      checks.database = "ok";
    } catch {
      checks.database = "unavailable";
      problems.push("database");
    }
    try {
      const cursors = await withGlobal((c) => c.query("SELECT network_id, next_block_number, updated_at, last_error FROM network_cursors ORDER BY network_id"));
      checks.ingestion = loadNearNetworks().filter((network) => network.enabled).map((network) => {
        const cursor = cursors.rows.find((row) => row.network_id === network.id);
        const age = cursor ? Date.now() - new Date(cursor.updated_at).getTime() : null;
        const status = !cursor ? "not_started" : cursor.last_error ? "error" : age! > 30_000 ? "delayed" : "ok";
        if (status !== "ok") problems.push(`ingestion:${network.id}:${status}`);
        return { network: network.id, finalized_block: cursor ? (BigInt(cursor.next_block_number) - 1n).toString() : null, seconds_since_progress: age === null ? null : Math.round(age / 1000), last_error: cursor?.last_error ?? null, status };
      });
    } catch {
      checks.ingestion = "unknown";
      problems.push("ingestion");
    }
    try {
      const w = (
        await withSystem((c) =>
          c.query(`SELECT
              count(*) FILTER (WHERE status IN ('pending','retrying') AND next_attempt_at <= now())::int AS due,
              COALESCE(EXTRACT(EPOCH FROM now() - min(next_attempt_at) FILTER (WHERE status IN ('pending','retrying') AND next_attempt_at <= now())), 0)::int AS oldest_due_seconds,
              count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '1 hour')::int AS failed_last_hour,
              count(*) FILTER (WHERE status = 'delivered' AND delivered_at > now() - interval '1 hour')::int AS delivered_last_hour
            FROM webhook_deliveries`)
        )
      ).rows[0];
      // A due delivery waiting more than two minutes means the delivery worker isn't running.
      const status = w.oldest_due_seconds > 120 ? "stalled" : "ok";
      if (status !== "ok") problems.push(`webhooks:${status}`);
      checks.webhooks = { status, ...w };
    } catch {
      checks.webhooks = "unknown";
    }
    const warnings: string[] = [];
    const ok = problems.length === 0;
    const code = checks.database !== "ok" || (strict && !ok) ? 503 : 200;
    return reply.code(code).send({ status: ok ? "ok" : "degraded", problems, warnings, version: "2026-11-01", time: new Date().toISOString(), checks });
  });

  authRoutes(app);
  organizationRoutes(app);
  walletRoutes(app);
  customerRoutes(app);
  invoiceRoutes(app);
  orderRoutes(app);
  // Its own scope: a JSON parser that keeps the raw body, for signature checks, without touching other routes.
  app.register(inboundOrderRoutes);
  app.register(inboundPaymentSourceRoutes);
  paymentRoutes(app);
  paymentSourceRoutes(app);
  payoutRoutes(app);
  evidenceRoutes(app);
  reportingRoutes(app);
  accountingRoutes(app);
  developerRoutes(app);
  publicRoutes(app);
  assistantRoutes(app);

  app.get("/openapi.json", { schema: { hide: true } as never }, async () => app.swagger());
  return app;
}

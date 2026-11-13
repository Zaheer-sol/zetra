import { randomBytes } from "node:crypto";
import { appEnv } from "@zetra/config";
import { withGlobal } from "@zetra/database";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server";

export interface Session {
  cookie: string;
  orgId: string;
  email: string;
}

let instance: Promise<FastifyInstance> | undefined;
export function server(): Promise<FastifyInstance> {
  instance ??= buildServer({ logger: false });
  return instance;
}

export const randomAddress = () => `acct-${randomBytes(10).toString("hex")}.testnet`;

export async function call(
  method: string,
  url: string,
  auth: { cookie?: string; key?: string } | null = {},
  payload?: unknown,
  extraHeaders: Record<string, string> = {}
) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (auth?.cookie) headers.cookie = auth.cookie;
  if (auth?.key) headers.authorization = `Bearer ${auth.key}`;
  if (auth?.cookie && !auth.key && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    headers.origin ??= appEnv().WEB_ORIGIN;
  }
  const response: any = await (await server()).inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) } as any);
  const contentType = String(response.headers["content-type"] ?? "");
  let data: any = null;
  if (contentType.includes("json") && response.body) data = response.json();
  return { statusCode: response.statusCode as number, headers: response.headers as Record<string, string | string[] | undefined>, body: response.body as string, data };
}

export async function signup(businessName = "Test Business"): Promise<Session> {
  const suffix = randomBytes(8).toString("hex");
  const email = `owner-${suffix}@zetra.test`;
  const response = await call("POST", "/v1/auth/signup", {}, { name: "Test Owner", email, password: "Test-password-1234!", business_name: businessName });
  if (response.statusCode !== 201) throw new Error(`Signup failed: ${response.statusCode} ${response.body}`);
  const raw = response.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0];
  if (!cookie) throw new Error("Signup did not return a session cookie");
  return { cookie, orgId: response.data.organization_id, email };
}

export async function setupTestEnvironment(session: Session) {
  const auth = { cookie: session.cookie };
  // Wallet integration fixtures exercise NEAR Testnet, so assign these test users to the
  // dedicated test environment before using the production-guarded workspace API.
  await withGlobal(async (client) => {
    const result = await client.query("UPDATE users SET default_environment = 'test' WHERE lower(email) = lower($1)", [session.email]);
    if (result.rowCount !== 1) throw new Error("Could not assign the integration-test user to the test environment.");
  });
  const environmentResponse = await call("POST", "/v1/session/environment", auth, { environment: "test" });
  if (environmentResponse.statusCode >= 300) throw new Error(`Test environment setup failed: ${environmentResponse.body}`);
}

export async function setupWorkspace(session: Session) {
  const auth = { cookie: session.cookie };
  await setupTestEnvironment(session);
  const walletResponse = await call("POST", "/v1/wallets", auth, {
    name: "Main Receiving Wallet",
    network: "near:testnet",
    address: randomAddress(),
    assets: ["USDC"]
  });
  if (walletResponse.statusCode >= 300) throw new Error(`Wallet setup failed: ${walletResponse.body}`);
  const create = async (name: string) => {
    const address = randomAddress();
    const response = await call("POST", "/v1/customers", auth, {
      name,
      email: `${name.toLowerCase().replaceAll(" ", "-")}@zetra.test`,
      wallet_addresses: [{ address, network: "near:testnet" }]
    });
    if (response.statusCode >= 300) throw new Error(`Customer setup failed: ${response.body}`);
    return { customer: response.data, address };
  };
  const acme = await create("Acme Ltd");
  const nova = await create("Nova Systems");
  const studio = await create("Studio Ten");
  return { wallet: walletResponse.data, acme: acme.customer, nova: nova.customer, studio: studio.customer, acmeAddress: acme.address, novaAddress: nova.address, studioAddress: studio.address };
}

export async function apiKey(session: Session): Promise<string> {
  const response = await call("POST", "/v1/api-keys", { cookie: session.cookie }, { name: "Integration test", mode: "test", scope: "read_write" });
  if (response.statusCode !== 201) throw new Error(`API key creation failed: ${response.body}`);
  return response.data.secret;
}

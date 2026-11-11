import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const [{ appEnv }, { closePools, withGlobal }, { buildServer }] = await Promise.all([
  import("../backend/packages/config/src/index.ts"),
  import("../backend/packages/database/src/index.ts"),
  import("../backend/src/server.ts")
]);

const DEMO_EMAIL = "demo@zetra.local";
const DEMO_PASSWORD = "Zetra-Demo-2026!";
const BUSINESS = "Zetra Demo Lab";
const app = await buildServer({ logger: false });
let cookie = "";

async function request(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (cookie && !["GET", "HEAD", "OPTIONS"].includes(method)) headers.origin = appEnv().WEB_ORIGIN;
  const response = await app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body }) });
  const data = response.body && String(response.headers["content-type"] ?? "").includes("json") ? response.json() : response.body;
  if (response.statusCode >= 300) throw new Error(`${method} ${url} returned ${response.statusCode}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  const setCookie = response.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (raw) cookie = raw.split(";", 1)[0] ?? cookie;
  return data as any;
}

async function signIn() {
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: DEMO_EMAIL, password: DEMO_PASSWORD } });
  if (login.statusCode === 401) {
    await request("POST", "/v1/auth/signup", { name: "Demo Owner", email: DEMO_EMAIL, password: DEMO_PASSWORD, business_name: BUSINESS });
    return;
  }
  if (login.statusCode >= 300) throw new Error(`Demo login returned ${login.statusCode}: ${login.body}`);
  const setCookie = login.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error("Demo login did not return a session cookie");
  cookie = raw.split(";", 1)[0] ?? "";
}

async function ensureWallet() {
  const wallets = (await request("GET", "/v1/wallets?limit=100")).data as any[];
  const existing = wallets.find((wallet) => wallet.address === "zetra-demo.testnet");
  if (existing) return existing;
  return request("POST", "/v1/wallets", {
    name: "Demo NEAR Receiving Account",
    network: "near:testnet",
    address: "zetra-demo.testnet",
    assets: ["USDC"]
  });
}

async function ensureCustomer(name: string, email: string, externalRef: string, address: string) {
  const found = (await request("GET", `/v1/customers?external_ref=${encodeURIComponent(externalRef)}&limit=100`)).data?.[0];
  if (found) return found;
  return request("POST", "/v1/customers", {
    name,
    email,
    external_ref: externalRef,
    wallet_addresses: [{ address, network: "near:testnet", label: "Customer payer account" }]
  });
}

async function ensureInvoice(input: Record<string, unknown>) {
  const invoices = (await request("GET", `/v1/invoices?search=${encodeURIComponent(String(input.number))}&limit=100`)).data as any[];
  const found = invoices.find((invoice) => invoice.number === input.number);
  return found ?? request("POST", "/v1/invoices", input);
}

try {
  await signIn();
  await request("POST", "/v1/session/environment", { environment: "test" });
  await withGlobal((c) => c.query("UPDATE users SET default_environment = 'test' WHERE lower(email) = $1", [DEMO_EMAIL]));
  await request("PATCH", "/v1/organization", { onboarding_completed: true });
  const wallet = await ensureWallet();
  const acme = await ensureCustomer("Acme Creative Studio", "accounts@acme.test", "DEMO-CUSTOMER-ACME", "acme-payer.testnet");
  const nova = await ensureCustomer("Nova Systems", "finance@nova.test", "DEMO-CUSTOMER-NOVA", "nova-payer.testnet");

  const first = await ensureInvoice({
    customer_id: acme.id,
    wallet_id: wallet.id,
    number: "DEMO-001",
    title: "Brand and website delivery",
    purpose: "Strategy, design and production website delivery",
    line_items: [
      { description: "Brand strategy", quantity: 1, unit_amount: "900.00" },
      { description: "Website delivery", quantity: 1, unit_amount: "1500.00" }
    ],
    due_at: "2026-11-10T23:59:59.000Z"
  });
  const second = await ensureInvoice({
    customer_id: nova.id,
    wallet_id: wallet.id,
    number: "DEMO-002",
    title: "Platform implementation",
    purpose: "Implementation and operational handover",
    line_items: [
      { description: "Implementation", quantity: 1, unit_amount: "1800.00" },
      { description: "Operational handover", quantity: 1, unit_amount: "240.00" }
    ],
    due_at: "2026-11-12T23:59:59.000Z"
  });
  await ensureInvoice({
    customer_id: nova.id,
    wallet_id: wallet.id,
    number: "DEMO-003",
    title: "November advisory retainer",
    purpose: "Monthly product and operations advisory",
    amount: "1550.00",
    due_at: "2026-11-15T23:59:59.000Z"
  });

  const payments = (await request("GET", "/v1/payments?limit=100")).data as any[];
  if (!payments.some((payment) => payment.invoice?.id === first.id)) {
    await request("POST", "/v1/test/payments", { scenario: "exact", invoice_id: first.id, finalize: true });
  }
  if (!payments.some((payment) => payment.invoice?.id === second.id)) {
    await request("POST", "/v1/test/payments", { scenario: "exact", invoice_id: second.id, finalize: true });
  }
  if (!payments.some((payment) => payment.status === "needs_review" && payment.amount === "740.00")) {
    await request("POST", "/v1/test/payments", { scenario: "unknown", wallet_id: wallet.id, amount: "740.00", finalize: true });
  }

  console.log("Demo workspace is ready.");
  console.log(`Business: ${BUSINESS}`);
  console.log(`Email: ${DEMO_EMAIL}`);
  console.log(`Password: ${DEMO_PASSWORD}`);
} finally {
  await app.close();
  await closePools();
}

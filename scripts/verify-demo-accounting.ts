import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const [{ appEnv }, { closePools }, { buildServer }] = await Promise.all([
  import("../backend/packages/config/src/index.ts"),
  import("../backend/packages/database/src/index.ts"),
  import("../backend/src/server.ts")
]);

const app = await buildServer({ logger: false });
let cookie = "";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

async function request(url: string) {
  const response = await app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
  if (response.statusCode >= 300) throw new Error(`GET ${url} returned ${response.statusCode}: ${response.body}`);
  return response.json() as any;
}

try {
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "demo@zetra.local", password: "Zetra-Demo-2026!" } });
  check(login.statusCode === 200, "the deterministic demo account can sign in");
  const setCookie = login.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  check(Boolean(raw), "login returns a session cookie");
  cookie = raw!.split(";", 1)[0]!;

  const me = await request("/v1/me");
  check(me.organization?.name === "Zetra Demo Lab", "the demo session opens Zetra Demo Lab");
  check(me.environment === "test", "the demo is isolated in test mode");

  const invoices = (await request("/v1/invoices?limit=100")).data.filter((invoice: any) => String(invoice.number).startsWith("DEMO-"));
  check(invoices.length === 3, "three deterministic demo invoices exist");
  check(invoices.find((invoice: any) => invoice.number === "DEMO-001")?.status === "paid", "DEMO-001 is fully reconciled");
  check(invoices.find((invoice: any) => invoice.number === "DEMO-002")?.status === "paid", "DEMO-002 is fully reconciled");
  check(invoices.find((invoice: any) => invoice.number === "DEMO-003")?.status === "open", "DEMO-003 remains an open $1,550 receivable");

  const payments = (await request("/v1/payments?limit=100")).data;
  check(payments.filter((payment: any) => payment.status === "matched").length === 2, "two settled simulated payments are matched once");
  check(payments.filter((payment: any) => payment.status === "needs_review" && payment.amount === "740.00").length === 1, "$740 of unidentified money is held for review");

  const year = new Date().getUTCFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const health = await request("/v1/accounting/health");
  const healthCheck = (key: string) => health.checks.find((item: any) => item.key === key);
  check(healthCheck("trial_balance")?.status === "ok", "total debits equal total credits");
  check(healthCheck("missing_entries")?.status === "ok", "every settled demo payment has its automatic receipt entry");
  check(healthCheck("receivables")?.status === "ok", "the Accounts Receivable ledger agrees with unpaid invoices");
  check(healthCheck("payments_to_identify")?.status === "attention", "unidentified money is disclosed instead of counted as revenue");

  const trial = await request(`/v1/accounting/reports/trial-balance?as_of=${to}`);
  check(trial.totals.balanced === true && trial.totals.debit === trial.totals.credit, "the trial balance report balances");
  check(trial.totals.debit === "6730.00", "the trial balance contains the expected $6,730 on each side");

  const receivables = await request(`/v1/accounting/reports/receivables-aging?as_of=${to}`);
  check(receivables.total === "1550.00", "receivables aging totals $1,550");
  check(receivables.ledger_check?.matches === true, "receivables aging ties to the Accounts Receivable control account");

  const profit = await request(`/v1/accounting/reports/profit-and-loss?from=${from}&to=${to}`);
  check(profit.revenue.total === "5990.00" && profit.net_income === "5990.00", "accrual revenue and net income are $5,990");

  const balance = await request(`/v1/accounting/reports/balance-sheet?as_of=${to}`);
  check(balance.balanced === true, "the balance sheet balances");
  check(balance.assets.total === "6730.00", "assets are $6,730");
  check(balance.liabilities.total === "740.00", "the $740 unidentified receipt remains a liability");
  check(balance.equity.total === "5990.00", "current earnings are $5,990");

  const cash = await request(`/v1/accounting/reports/cash-flow?from=${from}&to=${to}`);
  check(cash.reconciles === true, "cash-flow categories reconcile to the change in cash");
  check(cash.closing_balance === "5180.00", "closing wallet cash is $5,180");

  const csv = await app.inject({ method: "GET", url: `/v1/accounting/reports/trial-balance?as_of=${to}&format=csv`, headers: { cookie } });
  check(csv.statusCode === 200 && csv.body.includes("Zetra Demo Lab") && csv.body.includes("Total"), "the accountant CSV export is generated from the same ledger");

  console.log("\nAccounting verification passed: payments, invoices, subledgers and financial statements agree.");
} finally {
  await app.close();
  await closePools();
}

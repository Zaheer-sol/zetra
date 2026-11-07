import { createHash } from "node:crypto";
import type { Client } from "@zetra/database";
import type { Environment } from "@zetra/schemas";
import { newId } from "@zetra/schemas";
import { EngineError, type Actor, audit } from "../context";
import { accountingHealth, balanceSheet, cashFlow, payablesAging, profitAndLoss, receivablesAging, trialBalance } from "./reports";

type Row = Record<string, any>;
export const CLOSE_SCHEMA_VERSION = "1.0";
export const LEDGER_VERSION = "accounting-v1.0";

function normalizedDecimal(value: unknown): unknown {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = raw.split(".");
  const w = whole.replace(/^0+(?=\d)/, "") || "0";
  const f = fraction.replace(/0+$/, "");
  return `${negative && (w !== "0" || f) ? "-" : ""}${w}${f ? `.${f}` : ""}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    // Arrays in a close artifact represent collections (journal entries, evidence IDs,
    // report formats), not an execution sequence. Sort their canonical forms so the
    // same accounting period hashes identically even if a caller assembled a collection
    // in a different order.
    return value.map(canonical).sort((a, b) => {
      const left = JSON.stringify(a);
      const right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return normalizedDecimal(value);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function dateOnly(value: string | Date): string {
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 10);
}

function monthBounds(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new EngineError("invalid_period", "Use YYYY-MM.", 422);
  const [year, m] = month.split("-").map(Number) as [number, number];
  return { start: `${month}-01`, end: new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10) };
}

export async function closeArtifact(client: Client, organizationId: string, environment: Environment, input: { periodStart: string; periodEnd: string }) {
  const periodStart = dateOnly(input.periodStart);
  const periodEnd = dateOnly(input.periodEnd);
  // A tenant transaction uses one pg client. Keep these queries sequential so close generation is
  // deterministic and compatible with pg clients that reject overlapping queries.
  const org = await client.query("SELECT id, slug FROM organizations WHERE id = $1", [organizationId]);
  await client.query("SELECT method, reporting_currency FROM accounting_settings WHERE organization_id = $1 AND environment = $2", [organizationId, environment]);
  const health = await accountingHealth(client, organizationId, environment);
  const tb = await trialBalance(client, organizationId, environment, periodEnd);
  const pl = await profitAndLoss(client, organizationId, environment, periodStart, periodEnd);
  const bs = await balanceSheet(client, organizationId, environment, periodEnd);
  const cf = await cashFlow(client, organizationId, environment, periodStart, periodEnd);
  const ar = await receivablesAging(client, organizationId, environment, periodEnd);
  const ap = await payablesAging(client, organizationId, environment, periodEnd);
  if (!org.rows[0]) throw new EngineError("organization_not_found", "No such organization.", 404);
  const journals = (await client.query(
    `SELECT e.id, e.number, e.entry_date, e.source_type, e.source_id, e.description,
            COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'position', l.position, 'account_id', l.account_id, 'debit', l.debit::text, 'credit', l.credit::text, 'invoice_id', l.invoice_id, 'payment_id', l.payment_id, 'memo', l.memo) ORDER BY l.position) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
       FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id = e.id
      WHERE e.organization_id = $1 AND e.environment = $2 AND e.status = 'posted' AND e.entry_date BETWEEN $3::date AND $4::date
      GROUP BY e.id ORDER BY e.entry_date, e.id`,
    [organizationId, environment, periodStart, periodEnd]
  )).rows as Row[];
  const payments = (await client.query(
    `SELECT p.id, p.observation_id, p.transaction_hash, p.block_number, p.amount::text AS amount, p.status, p.source,
            p.invoice_id, p.asset_id, p.network_id
       FROM payments p WHERE p.organization_id = $1 AND p.environment = $2 AND p.block_timestamp::date BETWEEN $3::date AND $4::date
      ORDER BY p.id`,
    [organizationId, environment, periodStart, periodEnd]
  )).rows;
  const exports = { schema: "zetra.close-export.v1", formats: ["journal.csv", "trial-balance.json", "balance-sheet.json", "profit-and-loss.json", "cash-flow.json"], period_start: periodStart, period_end: periodEnd };
  const artifact = {
    schema_version: CLOSE_SCHEMA_VERSION,
    organization_id: organizationId,
    environment,
    period_start: periodStart,
    period_end: periodEnd,
    ledger_version: LEDGER_VERSION,
    journal_entries: journals.map((j) => {
      // The public artifact carries identifiers and hashes only. Descriptions, memos and customer
      // details stay local; they are not needed for independent verification of the close root.
      const safeEntry = { id: j.id, number: j.number, entry_date: dateOnly(j.entry_date), source_type: j.source_type, lines: (j.lines as Row[]).map((line) => ({ id: line.id, position: line.position, account_id: line.account_id, debit: line.debit, credit: line.credit, invoice_id: line.invoice_id, payment_id: line.payment_id })) };
      return { id: j.id, number: j.number, entry_date: dateOnly(j.entry_date), hash: sha256Canonical(safeEntry) };
    }),
    payment_evidence_ids: payments.map((p) => ({ id: p.id, observation_id: p.observation_id, transaction_hash: p.source === "simulated" ? null : p.transaction_hash, source: p.source, status: p.status, amount: p.amount, invoice_id: p.invoice_id, asset_id: p.asset_id, network_id: p.network_id })),
    report_totals: { trial_balance: tb.totals, profit_and_loss: { revenue: pl.revenue.total, expenses: pl.operating_expenses.total, net_income: pl.net_income }, balance_sheet: { assets: bs.assets.total, liabilities: bs.liabilities.total, equity: bs.equity.total, balanced: bs.balanced }, cash_flow: { opening: cf.opening_balance, net_change: cf.net_change, closing: cf.closing_balance, reconciles: cf.reconciles }, receivables: { total: ar.total, ledger_check: ar.ledger_check }, payables: { total: ap.total, ledger_check: ap.ledger_check } },
    generated_exports: exports
  };
  const blocking = health.checks.filter((c) => c.status === "error").map((c) => c.key);
  if (!tb.totals.balanced) blocking.push("trial_balance");
  if (ar.ledger_check && !ar.ledger_check.matches) blocking.push("receivables");
  if (ap.ledger_check && !ap.ledger_check.matches) blocking.push("payables");
  const openIssues = (await client.query("SELECT count(*)::int AS count FROM accounting_issues WHERE organization_id = $1 AND environment = $2 AND resolved_at IS NULL", [organizationId, environment])).rows[0]?.count ?? 0;
  const unresolvedExceptions = (await client.query(
    `SELECT count(*)::int AS count FROM exceptions e LEFT JOIN payments p ON p.id = e.payment_id
      WHERE e.organization_id = $1 AND e.environment = $2 AND e.status = 'open'
        AND (p.block_timestamp::date BETWEEN $3::date AND $4::date OR e.created_at::date BETWEEN $3::date AND $4::date)`,
    [organizationId, environment, periodStart, periodEnd]
  )).rows[0]?.count ?? 0;
  if (Number(openIssues) || Number(unresolvedExceptions)) blocking.push("unresolved_exceptions");
  return { artifact, canonical: stableStringify(artifact), hash: sha256Canonical(artifact), blocking: [...new Set(blocking)], metadata: { journal_entry_count: journals.length, payment_evidence_count: payments.length, open_accounting_issues: Number(openIssues), open_exceptions: Number(unresolvedExceptions) } };
}

export async function previewClosePackage(client: Client, organizationId: string, environment: Environment, month: string) {
  const { start, end } = monthBounds(month);
  return closeArtifact(client, organizationId, environment, { periodStart: start, periodEnd: end });
}

export async function createClosePackage(client: Client, organizationId: string, environment: Environment, month: string, actor: Actor) {
  const { start, end } = monthBounds(month);
  const period = (await client.query("SELECT status FROM accounting_periods WHERE organization_id = $1 AND environment = $2 AND start_date = $3", [organizationId, environment, start])).rows[0];
  if (period?.status !== "closed") throw new EngineError("period_not_closed", "Close the accounting period before creating a Proof-of-Close package.", 409);
  const preview = await closeArtifact(client, organizationId, environment, { periodStart: start, periodEnd: end });
  if (preview.blocking.length) throw new EngineError("close_not_ready", `The period has blocking checks: ${preview.blocking.join(", ")}.`, 409);
  const id = newId("booksAttestation");
  const row = (await client.query(
    `INSERT INTO close_packages (id, organization_id, environment, period_start, period_end, ledger_version, schema_version, canonical_hash, artifact, artifact_metadata, status, created_by, created_by_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'prepared',$11,$12)
     ON CONFLICT (organization_id,environment,period_start,period_end,canonical_hash) DO UPDATE SET updated_at=now()
     RETURNING *`,
    [id, organizationId, environment, start, end, LEDGER_VERSION, CLOSE_SCHEMA_VERSION, `0x${preview.hash}`, JSON.stringify(preview.artifact), JSON.stringify(preview.metadata), actor.id, actor.label]
  )).rows[0];
  await audit(client, actor, { organizationId, environment, action: "close_package_prepared", objectType: "close_package", objectId: row.id, next: { period_start: start, period_end: end, canonical_hash: `0x${preview.hash}` } });
  return serializeClosePackage(row);
}

export function serializeClosePackage(row: Row) {
  return { id: row.id, object: "close_package", organization_id: row.organization_id, environment: row.environment, period_start: dateOnly(row.period_start), period_end: dateOnly(row.period_end), ledger_version: row.ledger_version, schema_version: row.schema_version, canonical_hash: row.canonical_hash, artifact_metadata: row.artifact_metadata, status: row.status, near_network: row.near_network, contract_account: row.contract_account, transaction_hash: row.transaction_hash, block_hash: row.block_hash, explorer_url: row.explorer_url, created_by: row.created_by_label ?? row.created_by, created_at: row.created_at, updated_at: row.updated_at };
}

export async function verifyClosePackage(client: Client, organizationId: string, environment: Environment, id: string) {
  const row = (await client.query("SELECT * FROM close_packages WHERE id = $1 AND organization_id = $2 AND environment = $3", [id, organizationId, environment])).rows[0] as Row | undefined;
  if (!row) throw new EngineError("close_package_not_found", "No such close package.", 404);
  const actual = `0x${sha256Canonical(row.artifact)}`;
  const verified = actual === row.canonical_hash;
  if (!verified) await client.query("UPDATE close_packages SET status = 'verification_failed', updated_at = now() WHERE id = $1", [id]);
  return { id, verified, stored_hash: row.canonical_hash, computed_hash: actual, artifact_metadata: row.artifact_metadata };
}

export async function listClosePackages(client: Client, organizationId: string, environment: Environment) {
  const rows = (await client.query("SELECT * FROM close_packages WHERE organization_id = $1 AND environment = $2 ORDER BY period_end DESC, created_at DESC", [organizationId, environment])).rows;
  return { object: "list", data: rows.map(serializeClosePackage), has_more: false, next_cursor: null };
}

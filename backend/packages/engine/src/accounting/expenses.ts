import { type Client } from "@zetra/database";
import { newId, type Environment } from "@zetra/schemas";
import { audit, EngineError, type Actor } from "../context";
import { ensureBooks } from "./posting-rules";
import { isoDate, postEntry } from "./ledger";
import { emitBusinessEvent } from "./business-events";
import { money } from "./reports";
import { ledgerAmount } from "./amounts";
import { spendAccount, paidFromAccount } from "./payment-sources";
import { vendorById } from "./vendors";

type Row = Record<string, any>;

export interface ExpenseInput {
  title: string;
  description?: string | null;
  amount: string;
  account_id?: string | null;
  vendor_id?: string | null;
  expense_date?: string;
  reference?: string | null;
  paid_from_account_id: string;
  notes?: string | null;
}

/**
 * Record an expense paid from an accounting account. Created pending; approving posts it.
 */

export async function createExpense(client: Client, organizationId: string, environment: Environment, input: ExpenseInput & { approve?: boolean }, actor: Actor): Promise<Row> {
  await ensureBooks(client, organizationId, environment);
  const vendor = input.vendor_id ? await vendorById(client, organizationId, environment, input.vendor_id) : null;
  const account = await spendAccount(client, organizationId, environment, input.account_id, vendor);
  const amount = ledgerAmount(input.amount);
  let date = input.expense_date;
  await paidFromAccount(client, organizationId, environment, input.paid_from_account_id);
  date ??= isoDate(new Date());
  const id = newId("expense");
  await client.query(
    `INSERT INTO expenses (id, organization_id, environment, vendor_id, title, description, amount, account_id, expense_date, reference, method, paid_from_account_id, notes, created_by_id, created_by_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'offchain',$11,$12,$13,$14)`,
    [id, organizationId, environment, vendor?.id ?? null, input.title, input.description ?? null, amount.toString(), account.id, date, input.reference ?? null, input.paid_from_account_id, input.notes ?? null, actor.id ?? null, actor.label ?? null]
  );
  await audit(client, actor, { organizationId, environment, action: "expense_created", objectType: "expense", objectId: id, next: { title: input.title, amount: money(amount), vendor: vendor?.name ?? null } });
  if (input.approve) return approveExpense(client, organizationId, environment, id, actor);
  return (await client.query("SELECT * FROM expenses WHERE id = $1", [id])).rows[0] as Row;
}

/** Approve an expense: Dr the expense account and credit the recorded paying account. */
export async function approveExpense(client: Client, organizationId: string, environment: Environment, expenseId: string, actor: Actor): Promise<Row> {
  const x = (await client.query("SELECT * FROM expenses WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [expenseId, organizationId, environment])).rows[0] as Row | undefined;
  if (!x) throw new EngineError("not_found", "No such expense.", 404);
  if (x.status !== "pending") throw new EngineError("expense_not_pending", `This expense is ${x.status}.`, 409);
  await ensureBooks(client, organizationId, environment);
  const vendor = x.vendor_id ? ((await client.query("SELECT * FROM vendors WHERE id = $1", [x.vendor_id])).rows[0] as Row) : null;
  const creditAccount = x.paid_from_account_id;
  const amount = BigInt(x.amount);
  await client.query("UPDATE expenses SET status = 'approved', approved_at = now(), approved_by_id = $2, approved_by_label = $3, updated_at = now() WHERE id = $1", [x.id, actor.id ?? null, actor.label ?? null]);
  const { entry } = await postEntry(client, {
    organizationId,
    environment,
    date: x.expense_date,
    description: `Expense${vendor ? ` (${vendor.name})` : ""}: ${x.title}`,
    memo: x.description ?? x.notes ?? null,
    sourceType: "expense",
    sourceId: x.id,
    sourceKey: `expense:${x.id}`,
    actor,
    lines: [
      { accountId: x.account_id, debit: amount, vendorId: vendor?.id ?? null, expenseId: x.id, memo: x.title },
      { accountId: creditAccount, credit: amount, vendorId: vendor?.id ?? null, expenseId: x.id, memo: "Recorded payment" }
    ]
  });
  await emitBusinessEvent(client, { organizationId, environment, type: "EXPENSE_RECORDED", dedupeKey: `expense:${x.id}`, amount, vendorId: vendor?.id ?? null, journalEntryId: entry.id, data: { expense: { id: x.id, title: x.title, amount: money(amount), date: isoDate(x.expense_date instanceof Date ? x.expense_date : String(x.expense_date)), method: x.method }, vendor: vendor ? { id: vendor.id, name: vendor.name } : null } });
  await audit(client, actor, { organizationId, environment, action: "expense_approved", objectType: "expense", objectId: x.id, previous: { status: "pending" }, next: { status: "approved", journal_entry_id: entry.id } });
  return (await client.query("SELECT * FROM expenses WHERE id = $1", [x.id])).rows[0] as Row;
}

export async function rejectExpense(client: Client, organizationId: string, environment: Environment, expenseId: string, reason: string, actor: Actor): Promise<Row> {
  const x = (await client.query("SELECT * FROM expenses WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [expenseId, organizationId, environment])).rows[0] as Row | undefined;
  if (!x) throw new EngineError("not_found", "No such expense.", 404);
  if (x.status !== "pending") throw new EngineError("expense_not_pending", `This expense is ${x.status}; approved expenses are corrected with a reversing entry.`, 409);
  await client.query("UPDATE expenses SET status = 'rejected', rejected_reason = $2, updated_at = now() WHERE id = $1", [x.id, reason]);
  await audit(client, actor, { organizationId, environment, action: "expense_rejected", objectType: "expense", objectId: x.id, previous: { status: "pending" }, next: { status: "rejected", reason } });
  return (await client.query("SELECT * FROM expenses WHERE id = $1", [x.id])).rows[0] as Row;
}

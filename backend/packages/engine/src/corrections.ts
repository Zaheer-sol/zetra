import type { Client } from "@zetra/database";
import { newId, type CorrectPaymentInput } from "@zetra/schemas";
import { reverseCreditApplicationsForPayment } from "./accounting/customer-credits";
import { reverseEntry } from "./accounting/ledger";
import { audit, EngineError, log, type Actor } from "./context";
import { emitFinancialEvent } from "./financial-events";
import { applyPayment, closeExceptionsBySystem, recomputeInvoice } from "./pipeline";

type Row = Record<string, any>;

/**
 * Correct a settled allocation without editing history. The original allocation is compensated by
 * a negative allocation, its accounting entry is reversed by PAYMENT_UNASSIGNED, and an optional
 * replacement allocation is posted as a new economic event.
 */
export async function correctPayment(
  client: Client,
  organizationId: string,
  paymentId: string,
  input: CorrectPaymentInput,
  actor: Actor
): Promise<void> {
  const payment = (
    await client.query("SELECT * FROM payments WHERE id = $1 AND organization_id = $2 FOR UPDATE", [paymentId, organizationId])
  ).rows[0] as Row | undefined;
  if (!payment) throw new EngineError("not_found", "No such payment.", 404);
  if (!["matched", "partial", "overpaid"].includes(payment.status) || !payment.invoice_id) {
    throw new EngineError("payment_not_applied", "Only a payment currently applied to an invoice can be corrected.", 409);
  }

  const fromInvoice = (
    await client.query("SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [payment.invoice_id, organizationId, payment.environment])
  ).rows[0] as Row;
  let target: Row | null = null;
  if (input.action === "reassign") {
    target = (
      await client.query("SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [input.invoice_id, organizationId, payment.environment])
    ).rows[0] as Row | undefined ?? null;
    if (!target) throw new EngineError("invoice_not_found", "Choose an invoice from this workspace and mode.", 404);
    if (target.id === fromInvoice.id) throw new EngineError("same_invoice", "Choose a different invoice.", 422);
    if (target.status === "cancelled") throw new EngineError("invoice_cancelled", "A cancelled invoice cannot receive payments.", 409);
    if (target.network_id !== payment.network_id) throw new EngineError("network_mismatch", "The new invoice must use the same NEAR network as the payment.", 422);
    if (target.asset_id !== payment.asset_id) throw new EngineError("asset_mismatch", "The new invoice must use the same asset as the payment.", 422);
  }

  const active = (
    await client.query(
      `SELECT a.* FROM allocations a WHERE a.payment_id = $1 AND a.kind <> 'reversal'
         AND NOT EXISTS (SELECT 1 FROM allocations r WHERE r.reverses_allocation_id = a.id)
       ORDER BY a.created_at FOR UPDATE`,
      [payment.id]
    )
  ).rows as Row[];
  if (active.length === 0) throw new EngineError("allocation_missing", "This payment has no active allocation to correct.", 409);

  const correctionId = newId("correction");
  await client.query(
    `INSERT INTO payment_corrections
       (id, organization_id, environment, payment_id, action, from_invoice_id, to_invoice_id, reason, actor_type, actor_id, actor_label, previous_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      correctionId,
      organizationId,
      payment.environment,
      payment.id,
      input.action,
      fromInvoice.id,
      target?.id ?? null,
      input.reason,
      actor.type,
      actor.id ?? null,
      actor.label ?? null,
      JSON.stringify({ payment_status: payment.status, invoice_id: fromInvoice.id, invoice_status: fromInvoice.status, amount_paid: fromInvoice.amount_paid })
    ]
  );

  const activeCredits = (
    await client.query(
      `SELECT a.id FROM credit_applications a WHERE a.payment_id = $1 AND a.amount > 0
         AND NOT EXISTS (SELECT 1 FROM credit_applications r WHERE r.reverses_id = a.id)`,
      [payment.id]
    )
  ).rows as Array<{ id: string }>;
  const creditInvoices = await reverseCreditApplicationsForPayment(client, payment.id, `Payment allocation corrected: ${input.reason}`);
  for (const credit of activeCredits) {
    const entry = (
      await client.query(
        "SELECT id FROM journal_entries WHERE organization_id = $1 AND environment = $2 AND source_key = $3",
        [organizationId, payment.environment, `credit-apply:${credit.id}`]
      )
    ).rows[0] as { id: string } | undefined;
    if (entry) {
      await reverseEntry(client, organizationId, payment.environment, entry.id, {
        reason: `Payment allocation corrected: ${input.reason}`,
        actor,
        sourceKey: `credit-correction:${credit.id}`,
        automatic: true
      });
    }
  }
  for (const allocation of active) {
    await client.query(
      `INSERT INTO allocations (id, organization_id, environment, payment_id, invoice_id, amount, kind, correction_id, reverses_allocation_id)
       VALUES ($1,$2,$3,$4,$5,$6,'reversal',$7,$8)`,
      [newId("allocation"), allocation.organization_id, allocation.environment, payment.id, allocation.invoice_id, (-BigInt(allocation.amount)).toString(), correctionId, allocation.id]
    );
    await recomputeInvoice(client, allocation.invoice_id);
  }
  for (const invoiceId of creditInvoices) await recomputeInvoice(client, invoiceId);

  await client.query(
    "UPDATE payments SET status = 'needs_review', invoice_id = NULL, customer_id = NULL, context_source = NULL, updated_at = now() WHERE id = $1",
    [payment.id]
  );
  await closeExceptionsBySystem(client, { organizationId, paymentId: payment.id, reason: "The payment allocation was corrected by an operator." });
  await emitFinancialEvent(client, {
    organizationId,
    environment: payment.environment,
    type: "PAYMENT_UNASSIGNED",
    dedupeKey: `unassigned:${payment.id}:${correctionId}`,
    paymentId: payment.id,
    ruleVersion: "correction-v1.0",
    extra: { correction: { id: correctionId, action: input.action, reason: input.reason, from_invoice_id: fromInvoice.id, to_invoice_id: target?.id ?? null } }
  });

  if (target) {
    await applyPayment(client, { payment: { ...payment, status: "needs_review", invoice_id: null }, invoiceId: target.id, kind: "manual", correctionId, actor });
  }
  const after = (await client.query("SELECT status, invoice_id FROM payments WHERE id = $1", [payment.id])).rows[0] as Row;
  await client.query("UPDATE payment_corrections SET new_state = $2 WHERE id = $1", [correctionId, JSON.stringify(after)]);
  await audit(client, actor, {
    organizationId,
    environment: payment.environment,
    action: "payment_corrected",
    objectType: "payment",
    objectId: payment.id,
    previous: { status: payment.status, invoice_id: fromInvoice.id },
    next: { status: after.status, invoice_id: after.invoice_id, action: input.action, reason: input.reason, correction_id: correctionId }
  });
  log().info("payment_corrected", { organizationId, paymentId: payment.id, correctionId, action: input.action });
}

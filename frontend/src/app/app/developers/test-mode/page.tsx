"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { useSession } from "@/components/session";
import { Alert, Button, Card, ChoiceCard, ChoiceGroup, Field, Input, PageHeader, Select, useToast } from "@/components/app-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { api, useApi, type ApiError } from "@/lib/api";
import { money } from "@/lib/format";

const SCENARIOS = [
  { key: "exact", title: "Exact payment", desc: "The full remaining amount. Matches deterministically and marks the invoice paid.", needsInvoice: true },
  { key: "partial", title: "Partial payment", desc: "75% of the remaining amount. Applied only when the sender is a known customer wallet; otherwise it needs review.", needsInvoice: true },
  { key: "overpaid", title: "Overpayment", desc: "125% of the remaining amount from the customer's wallet. Paid, with an overpayment exception.", needsInvoice: true },
  { key: "duplicate", title: "Duplicate", desc: "The invoice amount again from the customer's wallet, after it's paid.", needsInvoice: true },
  { key: "unknown_sender", title: "Unknown sender", desc: "$740 from a wallet Zetra has never seen. Lands in Needs review with evidence.", needsInvoice: false },
  { key: "wrong_memo", title: "Wrong memo", desc: "A payment with an invalid reference; it cannot be silently matched.", needsInvoice: true },
  { key: "wrong_token", title: "Wrong token", desc: "A token the wallet doesn't accept. Recorded and held outside accounting.", needsInvoice: false },
  { key: "late", title: "Late payment", desc: "A valid payment received after the invoice due date.", needsInvoice: true },
  { key: "split", title: "Split payment", desc: "Two partial receipts run through the same matching and posting pipeline.", needsInvoice: true },
  { key: "refund", title: "Refund / reversal", desc: "A simulated payment followed by a compensating reversal.", needsInvoice: true },
  { key: "reorg", title: "Simulated reorg", desc: "Invalidates a simulated block and records compensating history.", needsInvoice: true },
  { key: "unsupported_account", title: "Unsupported account", desc: "Receipt outside the configured token/account boundary.", needsInvoice: false }
];

export default function TestModePage() {
  const router = useRouter();
  const toast = useToast();
  const { isTest } = useSession();
  const { data: invoices } = useApi<{ data: any[] }>("/v1/invoices?limit=100");
  const [scenario, setScenario] = useState("exact");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [finalize, setFinalize] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const chosen = SCENARIOS.find((s) => s.key === scenario)!;

  if (!isTest) {
    return (
      <div className="grid gap-6 [&>*]:min-w-0">
        <PageHeader title="Test payments" />
        <Alert tone="info" title="Switch to test mode">Simulated payments exist only in test mode. Use the Test mode switch in the sidebar.</Alert>
      </div>
    );
  }

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        breadcrumbs={[{ label: "Developers", href: "/app/developers" }, { label: "Test payments" }]}
        title="Test payments"
        description="Send simulated payments through the same pipeline used for configured networks: matching, exceptions, events and webhooks. Simulations do not move funds onchain."
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0">
        <Card title="Scenario">
          <form
            className="px-6 py-5 max-md:px-4 grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                const stress = ["split", "refund", "reorg", "unsupported_account"].includes(scenario);
                const p = await api<any>(stress ? "/v1/test/scenarios" : "/v1/test/payments", { method: "POST", body: { scenario, invoice_id: invoiceId || undefined, amount: amount || undefined, finalize } });
                toast("success", "Stress scenario ran through the normal pipeline. Simulation — no on-chain transaction.");
                const id = p.id ?? p.payment_id ?? p.payment_ids?.[0];
                if (id) router.push(`/app/payments/${id}`);
              } catch (err) {
                setError(err as ApiError);
                setBusy(false);
              }
            }}
          >
            {error && <Alert tone="danger">{error.message}</Alert>}
            <ChoiceGroup label="Scenario" value={scenario} onChange={(v) => { setScenario(v); setInvoiceId(""); setError(null); }} className="sm:grid-cols-2">
              {SCENARIOS.map((s) => (
                <ChoiceCard key={s.key} id={`scenario-${s.key}`} value={s.key} selected={scenario === s.key} title={s.title} description={s.desc} />
              ))}
            </ChoiceGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Invoice" htmlFor="t-invoice" optional={!chosen.needsInvoice}>
                <Select id="t-invoice" value={invoiceId} onValueChange={setInvoiceId} required={chosen.needsInvoice} options={[
                  { value: "", label: chosen.needsInvoice ? "Choose an invoice…" : "None" },
                  ...(invoices?.data
                    .filter((i) => (scenario === "duplicate" ? ["paid", "overpaid"].includes(i.status) : ["open", "partially_paid"].includes(i.status)))
                    .map((i) => ({ value: i.id, label: `${i.number} · ${i.customer.name} · ${money(i.amount_remaining)}` })) ?? [])
                ]} />
              </Field>
              <Field label="Amount override" htmlFor="t-amount" optional hint="Decimal USD, e.g. 1500.00">
                <Input id="t-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Automatic" />
              </Field>
            </div>
            <div className="flex items-start gap-2.5">
              <Checkbox id="finalize" checked={finalize} onCheckedChange={(v) => setFinalize(v === true)} className="mt-0.5" />
              <Label htmlFor="finalize" className="grid gap-0.5 leading-normal font-normal">
                Finalize immediately
                <span className="text-xs text-muted-foreground">Untick to see the “Payment detected → confirming” state first.</span>
              </Label>
            </div>
            <Button type="submit" variant="primary" loading={busy} disabled={chosen.needsInvoice && !invoiceId} icon={<FlaskConical />}>
              Send simulated payment
            </Button>
          </form>
        </Card>
        <div className="grid gap-6 [&>*]:min-w-0">
          <Card title="Network setup" padded>
            <p className="text-sm text-muted-foreground">
              Real transfers in test mode depend on the networks enabled by your server configuration. Configure the network, RPC endpoint and token contract before monitoring payments.
            </p>
          </Card>
          <Card title="Reorgs" padded>
            <p className="text-sm text-muted-foreground">
              Open any simulated payment and choose <strong>Simulate reorg</strong> to invalidate its block. Zetra records compensating history, reopens the invoice and sends <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.86em]">payment.reversed</code>.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

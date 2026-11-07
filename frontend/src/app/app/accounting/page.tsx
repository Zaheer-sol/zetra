"use client";

import { sumDecimalAmounts } from "@zetra/schemas";
import { NotebookPen } from "lucide-react";
import { ButtonLink, Card, Metric, Metrics, PageHeader, SkeletonRows } from "@/components/app-ui";
import { FinancialsGate, presetRange, useAccounts } from "@/components/ledger-components";
import { useSession } from "@/components/session";
import { qs, useApi } from "@/lib/api";

export default function AccountingPage() {
  const { can } = useSession();
  const { data: accounts } = useAccounts();
  const { data: open } = useApi<{ receipts: any[] }>("/v1/accounting/unclassified");
  const { data: pl } = useApi<any>(`/v1/accounting/reports/profit-and-loss${qs(presetRange("month"))}`);
  const balance = (key: string) => accounts?.data.find((a) => a.system_key === key)?.balance ?? "0.00";
  const cash = accounts ? sumDecimalAmounts(accounts.data.filter((a) => a.subtype === "cash").map((a) => a.balance)) : "…";
  const waiting = open?.receipts.length ?? 0;
  return <FinancialsGate><div className="grid gap-6">
    <PageHeader title="Books" description="A double-entry ledger for invoices, incoming NEAR payments, bills, expenses, and corrections." actions={<><ButtonLink href="/app/reports">Reports</ButtonLink>{can("financials:write") && <ButtonLink href="/app/accounting/journal/new" variant="primary" icon={<NotebookPen />}>Journal entry</ButtonLink>}</>} />
    <Metrics className="xl:grid-cols-5">
      <Metric label="Cash" value={cash} money foot="Wallet and bank accounts" href="/app/reports/balance-sheet" />
      <Metric label="Customers owe you" value={accounts ? balance("accounts_receivable") : "…"} money foot="Accounts receivable" href="/app/reports/receivables" />
      <Metric label="You owe vendors" value={accounts ? balance("accounts_payable") : "…"} money foot="Accounts payable" href="/app/reports/payables" />
      <Metric label="Net income" value={pl?.net_income ?? "…"} money foot="This month" href="/app/reports/profit-and-loss" />
      <Metric label="Needs a decision" value={open ? String(waiting) : "…"} foot={waiting ? "Incoming payments awaiting review" : "Nothing waiting"} href="/app/accounting/classify" warn={waiting > 0} />
    </Metrics>
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Review incoming payments" description="Classify unmatched NEAR payments, or assign them from the payment detail." actions={<ButtonLink size="sm" href="/app/accounting/classify">Open queue</ButtonLink>}><div className="px-6 pb-6 text-3xl font-semibold">{open ? waiting : "…"}</div></Card>
      <Card title="Ledger" description="Trace every accounting balance to its journal entries." actions={<ButtonLink size="sm" href="/app/accounting/journal">Open ledger</ButtonLink>}><div className="px-6 pb-6 text-sm text-muted-foreground">Use journal entries for adjustments and off-chain spending.</div></Card>
      <Card title="Periods" description="Review and close completed accounting periods." actions={<ButtonLink size="sm" href="/app/accounting/periods">Manage periods</ButtonLink>}><div className="px-6 pb-6 text-sm text-muted-foreground">Close a month after its payments and books are final.</div></Card>
    </div>
    {!accounts && <Card><SkeletonRows rows={3} cols={2} /></Card>}
  </div></FinancialsGate>;
}

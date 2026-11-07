"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, CheckCircle2 } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, SkeletonRows, Textarea, useToast } from "@/components/app-ui";
import { AccountSelect, FinancialsGate, TxProof, calendarDate, isClassifyAccount } from "@/components/ledger-components";
import { useSession } from "@/components/session";
import { api, useApi, type ApiError } from "@/lib/api";
import { shortAddress, tokenAmount } from "@/lib/format";

export default function ClassifyPage() {
  const { can } = useSession();
  const { data, error, mutate } = useApi<{ receipts: any[] }>("/v1/accounting/unclassified");
  const [payment, setPayment] = useState<any>(null);
  return <FinancialsGate><div className="grid gap-6">
    <PageHeader title="Needs a decision" description="Received NEAR payments that could not be safely matched to an invoice." />
    {error ? <Card><ErrorState error={error} retry={() => mutate()} /></Card> : !data ? <Card><SkeletonRows rows={4} cols={3} /></Card> : data.receipts.length === 0 ? <Card><EmptyState icon={<CheckCircle2 />} title="Everything is accounted for" mascot="success">Every received payment is matched, reviewed, or classified.</EmptyState></Card> : <Card title="Received, not identified" description="Apply a payment to an invoice from its payment page, or classify it as other income, a contribution, or a loan.">
      <ul className="divide-y">{data.receipts.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-4 px-6 py-4 max-md:px-4"><ArrowDownLeft className="size-4 text-success" /><div className="min-w-0 flex-1"><p className="font-semibold">{tokenAmount(r.amount, r.asset)}</p><p className="text-sm text-muted-foreground">From <span className="font-mono">{shortAddress(r.from_address)}</span> · {calendarDate(r.received_at.slice(0, 10))} · <TxProof hash={r.transaction_hash} /></p></div><div className="flex gap-2"><Link href={r.link} className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium hover:bg-accent">Apply to invoice</Link>{can("financials:write") && <Button size="sm" onClick={() => setPayment(r)}>Classify</Button>}</div></li>)}</ul>
    </Card>}
    {payment && <ClassifyModal payment={payment} onClose={() => setPayment(null)} onDone={() => { setPayment(null); mutate(); }} />}
  </div></FinancialsGate>;
}

function ClassifyModal({ payment, onClose, onDone }: { payment: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [account, setAccount] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiError | null>(null);
  const submit = async () => { setBusy(true); setError(null); try { await api("/v1/accounting/classifications", { method: "POST", body: { payment_id: payment.id, account_id: account, reason } }); toast("success", "Payment classified."); onDone(); } catch (e) { setError(e as ApiError); } finally { setBusy(false); } };
  return <Modal open onClose={onClose} title={`Classify ${tokenAmount(payment.amount, payment.asset)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!account || reason.trim().length < 3} onClick={submit}>Save</Button></>}><div className="grid gap-4">{error && <ErrorState error={error} />}<Field label="Account"><AccountSelect value={account} onChange={setAccount} filter={isClassifyAccount} placeholder="Choose an account" /></Field><Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Owner contribution" /></Field></div></Modal>;
}

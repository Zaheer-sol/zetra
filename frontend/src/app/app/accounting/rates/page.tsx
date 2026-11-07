"use client";

import { useState } from "react";
import { Coins, Plus } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, SkeletonRows, useToast } from "@/components/app-ui";
import { FinancialsGate, calendarDate } from "@/components/ledger-components";
import { useSession } from "@/components/session";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, useApi, type ApiError } from "@/lib/api";
import { todayIso } from "@/lib/format";

export default function RatesPage() {
  const { can } = useSession(); const { data, error, mutate } = useApi<{ data: any[] }>("/v1/accounting/fx-rates"); const [open, setOpen] = useState(false);
  return <FinancialsGate><div className="grid gap-6"><PageHeader title="Exchange rates" description="Set rates for non-USD accounting entries." actions={can("financials:manage") && <Button variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>Add rate</Button>} />
    <Card title="Rates">{error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <SkeletonRows rows={4} cols={3} /> : data.data.length === 0 ? <EmptyState icon={<Coins />} title="No rates yet">Dollar-pegged assets are valued at their peg.</EmptyState> : <Table><TableHeader><TableRow><TableHead>Pair</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Rate</TableHead></TableRow></TableHeader><TableBody>{data.data.map((rate) => <TableRow key={rate.id}><TableCell>1 {rate.base} = {rate.quote}</TableCell><TableCell>{calendarDate(rate.rate_date, { year: true })}</TableCell><TableCell className="text-right">{rate.rate}</TableCell></TableRow>)}</TableBody></Table>}</Card>
    {open && <RateModal onClose={() => setOpen(false)} onSaved={() => { setOpen(false); mutate(); }} />}
  </div></FinancialsGate>;
}
function RateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [form, setForm] = useState({ base: "", rate: "", rate_date: todayIso() }); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiError | null>(null);
  const save = async () => { setBusy(true); try { await api("/v1/accounting/fx-rates", { method: "POST", body: { ...form, quote: "USD" } }); toast("success", "Rate saved."); onSaved(); } catch (e) { setError(e as ApiError); } finally { setBusy(false); } };
  return <Modal open onClose={onClose} title="Add rate" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!form.base || !/^\d+(\.\d+)?$/.test(form.rate)} onClick={save}>Save</Button></>}><div className="grid gap-4">{error && <ErrorState error={error} />}<Field label="Asset"><Input value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value.toUpperCase() })} /></Field><Field label="1 unit in USD"><Input inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></Field><Field label="Date"><Input type="date" value={form.rate_date} onChange={(e) => setForm({ ...form, rate_date: e.target.value })} /></Field></div></Modal>;
}

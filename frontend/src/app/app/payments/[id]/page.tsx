"use client";

import { useParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { PaymentStatus } from "@/components/payment-tables";
import { RefundAction } from "./refund-action";
import { Address, Alert, BigMoney, ButtonLink, Card, CardBody, Chain, DetailGrid, ErrorState, KV, PageHeader, SimulatedTag, SkeletonBlock, Stack, TextLink } from "@/components/app-ui";
import { useApi } from "@/lib/api";
import { dateTime } from "@/lib/format";

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: p, error, mutate } = useApi<any>(`/v1/payments/${id}`, { refreshInterval: 2500 });
  const { data: graph } = useApi<any>(`/v1/payments/${id}/evidence`, { refreshInterval: 5000 });
  if (error) return <Card><ErrorState error={error} retry={() => mutate()} /></Card>;
  if (!p) return <Stack><SkeletonBlock height={180} /><SkeletonBlock height={260} /></Stack>;
  const exception = p.exceptions?.find((item: any) => item.status === "open");
  return <Stack>
    <PageHeader breadcrumbs={[{ label: "Payments", href: "/app/payments" }, { label: "Payment" }]} />
    <Card>
      <CardBody className="grid gap-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><PaymentStatus status={p.status} />{p.simulated && <SimulatedTag />}</div><BigMoney value={p.amount} asset={p.asset?.symbol ?? "Token"} /><p className="mt-2 text-sm text-muted-foreground">{p.simulated ? "Simulated demo record. No funds moved and no on-chain transaction occurred." : "Finalized NEAR transfer evidence is retained with this payment."}</p></div>{!p.simulated && p.explorer_url && <ButtonLink href={p.explorer_url} target="_blank" rel="noreferrer" icon={<ExternalLink />}>View transaction</ButtonLink>}</div>
        {exception && <Alert tone="warning" title={exception.summary} actions={<ButtonLink size="sm" href={`/app/exceptions/${exception.id}`}>Review</ButtonLink>}>{exception.detail}</Alert>}
      </CardBody>
    </Card>
    <DetailGrid>
      <Card title="Transfer"><CardBody><KV items={[["Network", <Chain key="network" network={p.network} name={p.network_name} />], ["From", <Address key="from" value={p.sender} full />], ["To", <Address key="to" value={p.recipient} full />], ["Asset", p.asset?.symbol ?? "Unknown token"], ["Received", dateTime(p.paid_at)], ["Transaction", p.simulated ? "Simulated, no on-chain transaction" : <Address key="tx" value={p.transaction_hash} href={p.explorer_url} full />]]} /></CardBody></Card>
      <Card title="Invoice"><CardBody className="grid gap-2">{p.invoice ? <TextLink href={`/app/invoices/${p.invoice.id}`}>{p.invoice.number ?? "Open invoice"}</TextLink> : p.invoice_detail ? <><TextLink href={`/app/invoices/${p.invoice_detail.id}`}>{p.invoice_detail.number ?? "Open invoice"}</TextLink>{p.decision?.exception_type === "duplicate_payment" && <span className="text-sm text-warning">Possible duplicate. This payment is held for review and has not been applied.</span>}</> : <span className="text-muted-foreground">Not assigned to an invoice.</span>}</CardBody></Card>
    </DetailGrid>
    {p.network_id?.startsWith("near:") && p.asset?.address && <RefundAction payment={p} onConfirmed={() => { void mutate(); }} />}
    {p.decision && <Card title="Matching decision" description={p.decision.explanation}><CardBody><ul className="grid gap-2 text-sm">{p.decision.checks?.map((check: any, index: number) => <li key={index}>{check.label ?? check}</li>)}</ul></CardBody></Card>}
    {graph && <Card title="Evidence graph" description="Why this payment was accepted, held, or posted. Every node links back to stored evidence."><CardBody><ol className="grid gap-3">{graph.nodes.map((node: any, index: number) => <li key={`${node.type}-${index}`} className="flex gap-3 text-sm"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><span className="min-w-0"><span className="font-medium capitalize">{node.type.replaceAll("_", " ")}</span><span className="ml-2 text-muted-foreground">{node.status}</span><p className="text-muted-foreground">{node.explanation}</p>{node.explorer_url && <a className="text-primary hover:underline" href={node.explorer_url} target="_blank" rel="noreferrer">View on explorer</a>}</span></li>)}</ol></CardBody></Card>}
  </Stack>;
}

"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Plus, TriangleAlert } from "lucide-react";
import { PaymentsTable } from "@/components/payment-tables";
import { useSession } from "@/components/session";
import { ButtonLink, Card, CardBody, ErrorState, Metric, Metrics, Money, Segmented, SkeletonBlock, SkeletonRows, Spinner } from "@/components/app-ui";
import { useApi } from "@/lib/api";

interface Overview {
  period: { name: string };
  metrics: {
    received: string;
    payments: number;
    matched: number;
    confirming: number;
    needs_attention: number;
    needs_attention_amount: string;
    unknown: number;
    outstanding: string;
    outstanding_invoices: number;
  };
  recent_activity: any[];
  needs_attention: any[];
  monitoring: Array<{ wallet_id: string; name: string; network: string; status: string; message: string }>;
  books: {
    method: string;
    reporting_currency: string;
    checks: Array<{ key: string; label: string; status: "ok" | "attention" | "error"; detail: string }>;
  };
  setup: { wallets: number; customers: number; invoices: number; payments: number; webhooks: number };
}

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" }
] as const;

export default function OverviewPage() {
  const { me } = useSession();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("today");
  const { data, error, mutate } = useApi<Overview>(`/v1/overview?period=${period}`, { refreshInterval: 5000, keepPreviousData: true });
  void me;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2.125rem] leading-[1.08] font-bold tracking-[-0.03em] max-md:text-[1.75rem]">Money and books</h1>
          <p className="mt-2 text-[1.0625rem] tracking-[-0.012em] text-muted-foreground">Received, outstanding and waiting for your decision.</p>
        </div>
        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.key, label: p.label }))} />
      </header>

      {error ? (
        <Card>
          <ErrorState error={error} retry={() => mutate()} />
        </Card>
      ) : !data ? (
        <SkeletonBlock height={104} />
      ) : (
        <>
          {data.setup.payments === 0 && <NextStep setup={data.setup} />}
          <Metrics label="Summary" className="grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
            <Metric
              label="Received"
              value={data.metrics.received}
              money
              href="/app/payments"
              foot={data.metrics.payments ? `${data.metrics.payments} payment${data.metrics.payments === 1 ? "" : "s"} · ${Math.round((data.metrics.matched / data.metrics.payments) * 100)}% matched automatically` : "No payments yet in this period"}
            />
            <Metric label="Outstanding" value={data.metrics.outstanding} money href="/app/invoices?status=open" foot={`${data.metrics.outstanding_invoices} open invoice${data.metrics.outstanding_invoices === 1 ? "" : "s"}`} />
            <Metric label="Needs review" value={String(data.metrics.needs_attention)} href="/app/exceptions" warn={data.metrics.needs_attention > 0} foot={data.metrics.needs_attention ? <Money value={data.metrics.needs_attention_amount} /> : "All clear"} />
          </Metrics>
          {data.metrics.confirming > 0 && (
            <div className="flex gap-3 rounded-xl bg-info/10 px-4 py-3 text-sm" role="status">
              <Spinner className="mt-0.5 text-info" />
              <div className="grid gap-0.5">
                <strong className="font-semibold">
                  {data.metrics.confirming} payment{data.metrics.confirming === 1 ? "" : "s"} confirming
                </strong>
                <span className="text-foreground/80">Seen on the network and waiting for its settlement rule.</span>
              </div>
            </div>
          )}
          <BooksHealth books={data.books} />
        </>
      )}

      <Card
        title="Recent payments"
        actions={
          <ButtonLink href="/app/payments" size="sm" variant="ghost">
            View all <ArrowRight />
          </ButtonLink>
        }
      >
        {!data ? <SkeletonRows rows={6} cols={4} /> : <PaymentsTable rows={data.recent_activity} compact />}
      </Card>
    </div>
  );
}

function NextStep({ setup }: { setup: Overview["setup"] }) {
  const steps = [
    { done: setup.wallets > 0, title: "Connect a receiving wallet", desc: "Zetra will monitor its public NEAR account for incoming USDC.", href: "/app/wallets?add=1", cta: "Connect wallet" },
    { done: setup.customers > 0, title: "Add a customer", desc: "Known sender accounts make automatic matching more reliable.", href: "/app/customers?add=1", cta: "Add customer" },
    { done: setup.invoices > 0, title: "Create your first invoice", desc: "Give Zetra something to reconcile incoming funds against.", href: "/app/invoices/new", cta: "Create invoice" },
    { done: setup.payments > 0, title: "Review the first payment", desc: "See its chain evidence, match decision and journal entry.", href: "/app/payments", cta: "View payments" }
  ];
  const next = steps.find((step) => !step.done);
  if (!next) return null;
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Next setup step · {steps.filter((step) => step.done).length + 1} of {steps.length}</p>
          <p className="mt-1 font-semibold">{next.title}</p>
          <p className="text-sm text-muted-foreground">{next.desc}</p>
        </div>
        <ButtonLink href={next.href} size="sm" variant="primary" icon={<Plus />}>{next.cta}</ButtonLink>
      </CardBody>
    </Card>
  );
}

function BooksHealth({ books }: { books: Overview["books"] }) {
  const errors = books.checks.filter((check) => check.status === "error");
  const review = books.checks.find((check) => check.status === "attention");
  const healthy = errors.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm" role="status">
      {healthy ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" /> : <TriangleAlert className="size-5 shrink-0 text-danger" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <strong className="font-semibold">{healthy ? "Books reconcile" : "Accounting needs repair"}</strong>
        <span className="ml-2 text-muted-foreground">
          {healthy ? `Trial balance and receivables agree${review ? `; ${review.detail}` : "."}` : errors.map((check) => check.detail).join(" ")}
        </span>
      </div>
      <ButtonLink href="/app/accounting" size="sm" variant="ghost">Open books <ArrowRight /></ButtonLink>
    </div>
  );
}

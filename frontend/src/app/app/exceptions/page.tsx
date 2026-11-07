"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Check } from "lucide-react";
import { ExceptionsList } from "@/components/payment-tables";
import { Card, EmptyState, ErrorState, Metric, Metrics, NavTabs, PageHeader, Pager, Select, SkeletonRows, useCursorPager } from "@/components/app-ui";
import { useRouter } from "next/navigation";
import { qs, useApi } from "@/lib/api";
import { EXCEPTION_TYPE_LABEL } from "@zetra/schemas";

function ExceptionsView() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "open";
  const type = params.get("type") ?? "";
  const pager = useCursorPager();
  const { reset } = pager;
  useEffect(() => reset(), [status, type, reset]);
  const { data, error, mutate } = useApi<{ data: any[]; has_more: boolean; next_cursor: string | null }>(`/v1/exceptions${qs({ status, type, limit: 30, starting_after: pager.cursor })}`, { refreshInterval: 8000, keepPreviousData: true });
  const { data: summary } = useApi<{ open_count: number; open_value: string; older_than_24h: number; resolved_last_30d: number }>("/v1/exceptions/summary", { refreshInterval: 8000 });
  const link = (s: string, t = type) => `/app/exceptions${qs({ status: s === "open" ? undefined : s, type: t })}`;

  return (
    <div>
      <PageHeader title="Needs review" description="Payments Zetra cannot apply safely. Review the evidence, choose an action and record the reason. The original state remains in the history." />
      {summary ? (
        <Metrics className="mb-6 xl:grid-cols-4">
          <Metric label="Open" value={String(summary.open_count)} foot="Payments awaiting a decision" warn={summary.open_count > 0} />
          <Metric label="Open value" value={summary.open_value} money foot="Unapplied USD-equivalent value" warn={summary.open_count > 0} />
          <Metric label="Older than 24h" value={String(summary.older_than_24h)} foot="Review ageing" warn={summary.older_than_24h > 0} />
          <Metric label="Resolved (30d)" value={String(summary.resolved_last_30d)} foot="Recorded operator decisions" />
        </Metrics>
      ) : null}
      <Card>
        <NavTabs
          label="Exception status"
          items={[
            { href: link("open"), label: "Open", active: status === "open" },
            { href: link("resolved"), label: "Resolved", active: status === "resolved" }
          ]}
        >
          <Select
            size="sm"
            className="my-2 w-auto"
            value={type}
            aria-label="Exception type"
            onValueChange={(v) => router.push(link(status, v))}
            options={[{ value: "", label: "All types" }, ...Object.entries(EXCEPTION_TYPE_LABEL).map(([k, v]) => ({ value: k, label: v }))]}
          />
        </NavTabs>
        <div>
          {error ? (
            <ErrorState error={error} retry={() => mutate()} />
          ) : !data ? (
            <SkeletonRows rows={6} cols={3} />
          ) : (
            <>
              <div>
                <ExceptionsList
                  rows={data.data}
                  empty={
                    status === "open" ? (
                      <EmptyState icon={<Check />} title="Nothing needs attention" mascot="resting">
                        Every payment that reached your wallets is matched or resolved. New exceptions appear here the moment Zetra can&rsquo;t decide safely.
                      </EmptyState>
                    ) : (
                      <EmptyState icon={<Check />} title="No resolved exceptions yet" mascot="curious">
                        Resolved exceptions and the reasons behind each decision are kept here permanently.
                      </EmptyState>
                    )
                  }
                />
              </div>
              <Pager hasMore={data.has_more} canPrev={pager.canPrev} onNext={() => pager.next(data.next_cursor)} onPrev={pager.prev} count={data.data.length} />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function ExceptionsPage() {
  return (
    <Suspense>
      <ExceptionsView />
    </Suspense>
  );
}

"use client";

import { AssistantPanel } from "@/components/assistant";
import { PageHeader } from "@/components/app-ui";

export default function AssistantPage() {
  return (
    <div>
      <PageHeader
        title="Zeti"
        description="Ask about payments, cash, profit, receivables, payables or the health of your books in plain language. Zeti uses Zetra records for every figure and asks before changing a financial record."
      />
      <div className="flex h-[min(78vh,880px)] overflow-hidden rounded-2xl bg-background shadow-card">
        <AssistantPanel full />
      </div>
    </div>
  );
}

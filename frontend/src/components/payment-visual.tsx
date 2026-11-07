"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./app-ui";

/**
 * An illustrative payment-to-invoice flow. It is a UI animation, not a live transaction.
 */
const STEPS = ["Payment record received", "Example checks shown", "Matched to Acme Ltd · INV-2041", "Example invoice marked paid"];

function useSequence(length: number, interval = 1100) {
  const [step, setStep] = useState(length);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setStep(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= length) clearInterval(t);
    }, interval);
    return () => clearInterval(t);
  }, [length, interval]);
  return step;
}

const hvCard = "rounded-[24px] border border-white/8 bg-card/95 px-[22px] py-5 text-left text-card-foreground shadow-overlay backdrop-blur-xl";
const hvLabel = "text-xs font-medium text-muted-foreground";

export function HeroVisual() {
  const step = useSequence(STEPS.length);
  const paid = step >= STEPS.length;
  return (
    <div className="w-full max-w-[410px] [transform-style:preserve-3d]" aria-label="Illustrative $2,000 payment flow, not a live transaction">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary shadow-card">
        <ArrowDownLeft className="size-3.5" aria-hidden="true" />
        <span>Incoming payment</span>
        <span className="text-primary/70">· 2,000 USDC</span>
      </div>
      <div className={cn(hvCard, "transition-shadow duration-700 [transform:translateZ(46px)]", paid && "shadow-[0_0_0_1px_rgba(48,209,88,0.35),0_0_48px_rgba(48,209,88,0.18),var(--overlay-shadow)]")}>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 font-semibold tracking-[-0.02em]">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <rect width="24" height="24" rx="7" style={{ fill: "var(--logo-bg)" }} />
              <rect x="5.5" y="7" width="10" height="3" rx="1.5" style={{ fill: "var(--logo-fg)" }} />
              <rect x="8.5" y="14" width="10" height="3" rx="1.5" style={{ fill: "var(--logo-fg)" }} />
              <circle cx="18" cy="8.5" r="1.6" fill="var(--brand)" />
            </svg>
            Zetra
          </span>
          <Badge tone="info">Example</Badge>
        </div>
        <ul className="my-4 grid gap-[9px]">
          {STEPS.map((label, i) => (
            <li key={label} className={cn("flex items-center gap-2.5 text-sm transition-colors", i < step ? "text-foreground" : i === step ? "text-foreground/80" : "text-muted-foreground")}>
              <span
                className={cn(
                  "grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-border transition-colors",
                  i < step && "border-success bg-success text-white",
                  i === step && "animate-spin border-dashed border-primary [animation-duration:3s]"
                )}
              >
                {i < step ? <Check className="size-[11px] stroke-[3]" /> : null}
              </span>
              {label}
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t pt-3.5">
          <div>
            <div className={hvLabel}>Acme Ltd</div>
            <div className="tabular mt-0.5 font-semibold">INV-2041</div>
          </div>
          <div className="text-right">
            <div className={hvLabel}>Amount due</div>
            <div className="tabular mt-0.5 font-semibold">$2,000.00</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthAsideVisual() {
  return (
    <div className="relative max-w-[400px] rounded-[22px] border-[0.5px] border-white/12 bg-white/4 px-[26px] py-6 backdrop-blur-xl">
      <div className="flex items-center justify-between text-sm text-[#a1a1a6]">
        <span>INV-2041 · Acme Ltd</span>
        <span className="rounded-full bg-[#30d158]/16 px-2.5 py-0.5 text-xs font-semibold text-[#30d158]">Paid</span>
      </div>
      <div className="tabular mt-2 mb-3.5 text-4xl font-semibold tracking-[-0.03em]">$2,000.00</div>
      <div className="grid gap-2 text-sm text-[#d2d2d7]">
        {["Receiving wallet checked", "Asset checked", "Payment status shown", "Amount checked", "Invoice match shown"].map((c) => (
          <div key={c} className="flex items-center gap-2">
            <Check className="size-[13px] stroke-[3] text-[#30d158]" /> {c}
          </div>
        ))}
      </div>
    </div>
  );
}

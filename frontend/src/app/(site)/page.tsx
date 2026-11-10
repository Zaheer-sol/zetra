import Link from "next/link";
import { ArrowRight, BadgeCheck, CheckCircle2, CircleDollarSign, FileSearch, GitMerge, Radar, Scale, ShieldCheck, Webhook, Zap } from "lucide-react";
import { HeroVisual } from "@/components/payment-visual";
import { HeroThreeScene } from "@/components/hero-three-scene";
import { Zeti } from "@/components/zeti";
import { Badge, ChainMark, CodeBlock } from "@/components/app-ui";
import { Bullet, Eyebrow, Feature, InlineCode, SectionHead, TextArrow, section, wrap } from "@/components/marketing";
import { Float, Pop, Reveal, ScrollLift, SlideIn, Stagger, StaggerItem, Tilt } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <>
      <section className="relative isolate overflow-hidden pt-22 pb-28 text-center max-md:pt-14 max-md:pb-18">
        <Stagger onView={false} gap={0.09} delay={0.05} className={wrap}>
          <StaggerItem>
            <Eyebrow>Invoices, payments and books for businesses paid in USDC</Eyebrow>
          </StaggerItem>
          <StaggerItem>
            <h1 className="mt-6 text-[clamp(2.75rem,5.6vw,4.75rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">Stablecoin payments.<br />Connected to your books.</h1>
          </StaggerItem>
          <StaggerItem>
            <p className="mx-auto mt-[22px] max-w-[680px] text-[clamp(1.1875rem,1.6vw,1.4375rem)] leading-[1.42] tracking-[-0.015em] text-pretty text-muted-foreground">
              Zetra monitors finalized NEAR payments and connects every confirmed transfer to the records in your books.
            </p>
          </StaggerItem>
          <StaggerItem>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-7 max-md:gap-5">
              <Button asChild size="lg">
                <Link href="/signup">Create your workspace</Link>
              </Button>
              <TextArrow href="#how">See how it works</TextArrow>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="mt-5 flex flex-wrap justify-center gap-[18px] text-sm text-muted-foreground">
              {["Paid straight to your wallet", "Every figure links to its transaction", "Exports to QuickBooks and Xero"].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" /> {t}
                </span>
              ))}
            </div>
          </StaggerItem>
          <StaggerItem>
            <ScrollLift className="mt-18 flex justify-center max-md:mt-12">
              <div className="relative isolate flex w-fit max-w-full flex-col items-center gap-5">
                <HeroThreeScene />
                <Float amplitude={6} duration={8}>
                  <div className="relative z-10">
                    <Tilt max={6} glare={false} scale={1}>
                      <HeroVisual />
                    </Tilt>
                  </div>
                </Float>
                <Zeti mood="welcome" size={170} priority className="absolute bottom-2 left-0 z-20 -translate-x-1/3 max-lg:hidden" />
                <Zeti mood="welcome" size={124} priority className="absolute bottom-2 left-0 z-20 -translate-x-1/3 max-md:hidden lg:hidden" />
                <Zeti mood="welcome" size={86} priority className="absolute bottom-[-22px] left-[-6px] z-20 md:hidden" />
              </div>
            </ScrollLift>
          </StaggerItem>
        </Stagger>
      </section>

      <section className="bg-[#0b1422] py-30 text-[#edf7f5] max-md:py-20 dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.12),inset_0_-0.5px_0_rgba(255,255,255,0.12)]">
        <div className={wrap}>
          <p className="mx-auto max-w-[980px] text-center text-[clamp(1.875rem,4vw,3.25rem)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">
            <span className="text-[#9fb7c6]">Example: a block explorer shows that 2,000 USDC moved.</span> Zetra can connect a payment record to invoice INV-2041 and the books.
          </p>
        </div>
      </section>

      <section className={section} id="how">
        <div className={wrap}>
          <Reveal>
            <SectionHead kicker="How it works" title="From a wallet address to a full set of books.">
              Start with the wallet you already use. Zetra reads its activity. Send invoices, or let your store send its orders, only when you want to.
            </SectionHead>
          </Reveal>
          <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Connect", "Add a public wallet address. Zetra only watches it. It never asks for keys and can't move your money."],
              ["Collect", "Send a payment request, connect your checkout, or keep accepting USDC at your existing address."],
              ["Match", "Zetra uses the payment reference, known customer wallets, the amount and the timing to work out what each payment is for. Anything uncertain waits for you."],
              ["Book", "Matched payments post to a double-entry ledger. Money nobody has claimed stays out of revenue until you say what it was."],
              ["Close", "Review profit and loss, balance sheet and cash flow. Every figure links back to the entries and transactions behind it."]
            ].map(([t, d], i) => (
              <StaggerItem key={t} className="h-full">
                <Tilt max={5} className="h-full rounded-[22px]">
                  <div className="grid h-full content-start gap-2 rounded-[22px] bg-card p-6 text-card-foreground">
                    <span className="tabular text-sm font-semibold text-primary">0{i + 1}</span>
                    <h3 className="text-xl font-semibold tracking-[-0.022em]">{t}</h3>
                    <p className="leading-normal text-muted-foreground">{d}</p>
                  </div>
                </Tilt>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className={cn(section, "pt-0")}>
        <div className={wrap}>
          <Reveal>
            <SectionHead kicker="Payments and payables" title="Know what you earned, spent and still owe.">
              Finalized NEAR receipts, invoices, bills and expenses land in the same ledger, with a source behind every posted entry.
            </SectionHead>
          </Reveal>
          <Stagger className="grid gap-4 md:grid-cols-3">
            <StaggerItem><Feature icon={<FileSearch />} title="Bills and expenses" body="Record what the business owes and what it has spent, approve the bill, then record the account used to pay it. Zetra records the accounting event; it does not move funds." /></StaggerItem>
            <StaggerItem><Feature icon={<Scale />} title="Double-entry books" body="Posted entries stay on record. A mistake is fixed with a reversing entry, so the history shows what changed and who changed it." /></StaggerItem>
            <StaggerItem><Feature icon={<CircleDollarSign />} title="Reports your accountant can check" body="Profit and loss, balance sheet and cash flow come from posted entries. Export them as CSV or in QuickBooks and Xero import layouts." /></StaggerItem>
          </Stagger>
          <p className="mt-6 text-sm text-muted-foreground">Zetra currently accounts for USD stablecoins. Stripe Checkout is supported as a processor clearing source; bank feeds and tax filing are outside the product today.</p>
        </div>
      </section>

      <section className={cn(section, "pt-0")}>
        <div className={wrap}>
          <Reveal>
            <SectionHead kicker="Illustrative example" title="A sample transfer, connected to a business record." />
          </Reveal>
          <div className="grid items-center gap-5 lg:grid-cols-[1fr_auto_1fr]">
            <SlideIn from="left" className="h-full">
              <div className="h-full rounded-[22px] bg-[#132336] p-7 font-mono text-[12.5px] leading-[1.8] text-[#c8d9df] shadow-raised dark:shadow-card" aria-label="Illustrative transfer data, not a live transaction">
                <h3 className="mb-4 font-sans text-sm font-semibold text-[#9fb7c6]">Example transfer data · not a live transaction</h3>
                {[
                  ["event ", "Transfer"],
                  ["asset ", "USDC"],
                  ["from  ", "acme.near"],
                  ["to    ", "merchant.near"],
                  ["value ", "2,000.00"],
                  ["record ", "Example only"]
                ].map(([k, v]) => (
                  <div key={k} className="whitespace-pre">
                    <span className="text-[#9fb7c6]">{k}</span>
                    <span className="text-[#edf7f5]">{v}</span>
                  </div>
                ))}
              </div>
            </SlideIn>
            <Pop delay={0.35} className="mx-auto">
              <div className="grid size-11 place-items-center rounded-full bg-card text-primary shadow-card max-lg:rotate-90" aria-hidden="true">
                <ArrowRight className="size-[18px]" />
              </div>
            </Pop>
            <SlideIn from="right" delay={0.15} className="h-full">
              <div className="h-full rounded-[22px] bg-card p-7 text-card-foreground shadow-raised" aria-label="What Zetra concludes">
                <h3 className="mb-4 text-sm font-semibold text-muted-foreground">Example invoice record</h3>
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-[1.0625rem] font-semibold">Acme Ltd paid INV-2041</strong>
                  <Badge tone="success">Paid</Badge>
                </div>
                <div className="tabular mt-2 mb-3.5 text-[1.75rem] font-semibold tracking-[-0.028em]">$2,000.00 USDC</div>
                <ul className="grid">
                  {["Receiving wallet checked", "Asset checked", "Amount checked", "Payment window checked", "Invoice match shown"].map((c) => (
                    <li key={c} className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0">
                      <span className="grid size-5 place-items-center rounded-full bg-success/12 text-success" aria-hidden="true">
                        <CheckCircle2 className="size-3" />
                      </span>
                      <span className="font-medium">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </SlideIn>
          </div>
        </div>
      </section>

      <section className={cn(section, "bg-card")}>
        <div className={wrap}>
          <div className="flex items-end justify-between gap-8">
            <Reveal>
              <SectionHead kicker="When a payment doesn&apos;t fit" title="Zetra doesn&apos;t guess with your money.">
                A partial payment, an overpayment, a payment in the wrong token or one nobody claims goes to a review list with the evidence and your options. Whatever you decide is recorded with your name and reason.
              </SectionHead>
            </Reveal>
            <Zeti mood="curious" size={150} className="mr-6 mb-10 max-md:hidden" />
          </div>
          <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <StaggerItem>
              <Feature
                inset
                icon={<CircleDollarSign />}
                title="Partial and overpayments"
                body="$1,500 of $2,000 is tracked as partially paid with $500 remaining. $2,500 is paid, with the $500 difference held as customer credit."
              />
            </StaggerItem>
            <StaggerItem>
              <Feature
                inset
                icon={<FileSearch />}
                title="Unknown payments"
                body="When nobody claims a payment, Zetra lists the invoices it could belong to and why each one fits. You assign it in two clicks, with a reason."
              />
            </StaggerItem>
            <StaggerItem>
              <Feature inset icon={<GitMerge />} title="Nothing gets overwritten" body="Chain evidence can&apos;t be edited. A reversal or a resolution is a new entry, so you can always see what happened and when." />
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      <section className={section}>
        <div className={cn(wrap, "grid items-center gap-14 lg:grid-cols-2")}>
          <Reveal>
            <SectionHead kicker="Illustrative workflow" title="A payment record can move from detection to bookkeeping." className="mb-0">
              This diagram describes an example product flow. It is not a live transaction or a timing measurement.
            </SectionHead>
            <ul className="mt-6 grid gap-3.5">
              <Bullet icon={<Zap />} title="Payment details received.">
                A payment record can be reviewed before it is applied to an invoice.
              </Bullet>
              <Bullet icon={<BadgeCheck />} title="Matching is reviewed.">
                The example shows checks for the receiving wallet, asset and amount before an invoice is marked paid.
              </Bullet>
              <Bullet icon={<Radar />} title="Chain behavior is not implied.">
                No transaction, confirmation or timing is represented by this illustration.
              </Bullet>
            </ul>
          </Reveal>
          <ScrollLift from={12}>
            <Tilt max={4} className="rounded-[28px]">
              <div className="rounded-[28px] bg-[#0b1422] p-9 text-[#edf7f5] shadow-overlay max-md:p-6 dark:shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.12)]">
                <div className="flex items-center gap-2.5">
                  <ChainMark className="size-[22px] rounded-[7px]" />
                  <strong className="font-semibold">Example payment workflow · not a live transaction</strong>
                </div>
                <Stagger className="mt-[22px] grid gap-2.5 text-sm" gap={0.18} delay={0.2}>
                  {[
                    ["Receive", <>A payment record is received</>],
                    ["Review", <>The example checks payment details</>],
                    ["Match", <>The example links the payment to INV-2041</>],
                    [
                      "Record",
                      <>
                        Example invoice status updated; <InlineCode dark>payment.matched</InlineCode> webhook shown
                      </>
                    ]
                  ].map(([t, d], i) => (
                    <StaggerItem key={i} className="grid grid-cols-[64px_1fr] gap-3 text-[#D4DEEC]">
                      <b className="font-mono font-medium text-[#a78bfa]">{t}</b>
                      <span>{d}</span>
                    </StaggerItem>
                  ))}
                </Stagger>
                <p className="mt-5 rounded-2xl bg-white/7 p-4 text-xs text-[#9fb7c6]">Illustration only. It does not show a live transaction or settlement timing.</p>
              </div>
            </Tilt>
          </ScrollLift>
        </div>
      </section>

      <section className={cn(section, "pt-0")}>
        <div className={cn(wrap, "grid items-center gap-14 lg:grid-cols-2")}>
          <SlideIn from="left">
            <CodeBlock
              label="Example payment.matched webhook payload"
              code={`POST /webhooks/zetra
x-zetra-event-type: payment.matched
x-zetra-signature: v1=6f1c…a09e

{
  "type": "payment.matched",
  "data": {
    "type": "PAYMENT_MATCHED",
    "customer": { "name": "Acme Ltd" },
    "invoice": { "number": "INV-2041", "status": "paid" },
    "payment": {
      "amount": "2000.00", "asset": "USDC",
      "network": "near:mainnet", "transaction_hash": "near-tx-abc…"
    },
    "evidence": { "block_number": "108488412",
                  "rule_version": "match-v1.1" }
  }
}`}
            />
          </SlideIn>
          <Reveal>
            <SectionHead kicker="For developers" title="Everything in the console is in the API." className="mb-0">
              The API is versioned, with idempotency keys, cursor pagination and consistent errors. Webhooks are signed with HMAC, retried with backoff and can be replayed.
            </SectionHead>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Button asChild>
                <Link href="/docs/quickstart">Read the quickstart</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/developers">API overview</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      <section className={cn(section, "pt-0")}>
        <Stagger className={cn(wrap, "grid gap-4 md:grid-cols-2 lg:grid-cols-3")}>
          <StaggerItem>
            <Feature icon={<ShieldCheck />} title="Non-custodial" body="Customers pay your wallet directly. Zetra reads public addresses only and never asks for keys, seed phrases or withdrawal rights." />
          </StaggerItem>
          <StaggerItem>
            <Feature icon={<Scale />} title="One ledger" body="Invoices, bills, expenses and reports all post to the same journal. A correction adds an entry and leaves the original in place." />
          </StaggerItem>
          <StaggerItem>
            <Feature icon={<Webhook />} title="A source for every record" body="An onchain payment keeps its transaction evidence. A bill entered by hand keeps its document, the approval and the journal entry." />
          </StaggerItem>
        </Stagger>
      </section>

      <section className={cn(section, "pt-0")}>
        <div className={wrap}>
          <Reveal y={40}>
            <div className="relative isolate overflow-hidden rounded-[32px] bg-card px-14 py-20 text-center text-card-foreground max-md:px-5 max-md:py-9">
              <Zeti mood="success" size={124} className="mb-4" />
              <h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.03em]">Explore Zetra.</h2>
              <p className="mt-3.5 text-[clamp(1.0625rem,1.3vw,1.25rem)] tracking-[-0.012em] text-muted-foreground">Create a workspace to explore the product. Demo payments are simulated; no live transaction is shown.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-2.5">
                <Button asChild size="lg">
                  <Link href="/signup">
                    Create your workspace <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}

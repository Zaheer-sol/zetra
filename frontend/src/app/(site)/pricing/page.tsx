import type { Metadata } from "next";
import Link from "next/link";
import { CheckList, PageHero, wrap } from "@/components/marketing";
import { Stagger, StaggerItem, Tilt } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pricing", description: "Zetra pricing: free up to 20 payments a month, Starter at $49, Growth at $149, and never a percentage of your payments." };

const PLANS = [
  {
    name: "Free",
    price: "$0",
    note: "Up to 20 payments / month",
    cta: "Start free",
    href: "/signup",
    features: ["Configured network support and test mode", "Invoices, payment page and matching", "Double-entry books and reports", "1 wallet, 1 teammate"]
  },
  {
    name: "Starter",
    price: "$49",
    per: "/month",
    note: "Up to 200 payments / month",
    cta: "Start with Starter",
    href: "/signup?plan=starter",
    features: ["Everything in Free", "Zeti, your accounting assistant", "Orders from Shopify, WooCommerce or your backend", "API, signed webhooks and accountant exports", "3 teammates"]
  },
  {
    name: "Growth",
    price: "$149",
    per: "/month",
    note: "Up to 2,000 payments / month",
    cta: "Start with Growth",
    href: "/signup?plan=growth",
    featured: true,
    features: ["Everything in Starter", "Multiple receiving wallets", "Bank reconciliation and month close", "Optional books publication when a contract is configured", "Unlimited teammates and roles", "Priority support"]
  },
  {
    name: "Scale",
    price: "Custom",
    note: "More than 2,000 payments / month",
    cta: "Create workspace",
    href: "/signup?plan=scale",
    features: ["Everything in Growth", "Volume pricing", "Hands-on setup and migration", "Named contact"]
  }
];

export default function PricingPage() {
  return (
    <>
      <PageHero title="Pay for the software, never a share of your receipts." mascot="curious">
        Free to start, then one monthly price set by how many payments you receive. Customers pay your wallet directly, so no percentage ever comes off a payment. No card needed to start, and paying yearly gets you two months free.
      </PageHero>
      <section className="pb-16">
        <Stagger className={`${wrap} grid gap-4 sm:grid-cols-2 lg:grid-cols-4`}>
          {PLANS.map((p) => (
            <StaggerItem key={p.name} className="h-full">
              <Tilt max={4} className="h-full rounded-3xl">
                <div className={cn("flex h-full flex-col gap-3.5 rounded-3xl bg-card p-7 text-card-foreground shadow-card", p.featured && "shadow-[0_0_0_2px_var(--primary),var(--raised-shadow)]")}>
                  <div>
                    <h3 className="text-[1.0625rem] font-semibold">{p.name}</h3>
                    <p className="text-sm text-muted-foreground">{p.note}</p>
                  </div>
                  <div className="text-4xl font-semibold tracking-[-0.03em]">
                    {p.price}
                    {p.per && <small className="text-sm font-medium tracking-normal text-muted-foreground">{p.per}</small>}
                  </div>
                  <CheckList items={p.features} className="gap-2 text-sm" />
                  <Button asChild variant={p.featured ? "default" : "secondary"} className="mt-auto">
                    <Link href={p.href}>{p.cta}</Link>
                  </Button>
                </div>
              </Tilt>
            </StaggerItem>
          ))}
        </Stagger>
      </section>
    </>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle2, Clock, ExternalLink, FlaskConical, Lock, QrCode, Wallet, XCircle } from "lucide-react";
import { useApi } from "@/lib/api";
import { dateShort, money, moneyParts } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChainMark, LineItems, Segmented, Spinner } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface NearPay {
  network: { id: "near:mainnet" | "near:testnet"; name: string; family: "near"; testnet: boolean; explorer_url: string | null; native_symbol: "NEAR"; rpc_url: string };
  asset: { id: string; symbol: "USDC"; name: string; address: string; decimals: number };
  recipient: string;
  amount: string;
  amount_base_units: string;
  payment_memo: string;
}

interface PublicView {
  merchant: { name: string; support_email: string | null };
  invoice: { number: string; title: string | null; purpose: string | null; line_items: Array<{ description: string; quantity: number; unit_amount: string; amount: string }>; customer_name: string; currency: string; amount_due: string; tax_amount?: string; amount_paid: string; amount_remaining: string; amount_confirming: string; due_at: string | null; expires_at: string | null; paid_at: string | null };
  state: "awaiting_payment" | "confirming" | "partially_paid" | "paid" | "overpaid" | "expired" | "cancelled";
  test_mode: boolean;
  pay: NearPay;
  payments: Array<{ amount: string; status: string; review_only?: boolean; transaction_hash: string | null; explorer_url: string | null; simulated: boolean; paid_at: string }>;
}

const NearWalletCheckout = dynamic(() => import("./near-wallet-checkout"), { ssr: false });
const cardCls = "rounded-[28px] bg-card p-8 text-card-foreground shadow-raised max-sm:rounded-[22px] max-sm:p-[22px]";
const titleCls = "text-[1.625rem] font-bold tracking-[-0.028em]";
const fieldLabelCls = "mb-1 text-xs text-muted-foreground";

async function publicCall<T>(path: string, method = "GET"): Promise<T> {
  const res = await fetch(`/api${path}`, { method, headers: { accept: "application/json" }, cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? "Something went wrong. Please try again.");
  return data as T;
}

export default function PayPage() {
  const { token } = useParams<{ token: string }>();
  const { data, error, mutate } = useApi<PublicView>(`/v1/public/payment-requests/${token}`, { refreshInterval: (view) => (view && ["cancelled", "expired"].includes(view.state) ? 0 : view && ["paid", "overpaid"].includes(view.state) ? 4000 : 2000), shouldRetryOnError: false });
  if (error) return <PayFrame><div className={cn(cardCls, "grid justify-items-center gap-2.5 text-center")}><XCircle className="size-7 text-muted-foreground" /><h1 className={titleCls}>Payment link not found</h1><p className="text-muted-foreground">This link is incorrect or no longer exists. Check the link you were sent, or contact the merchant for a new one.</p></div></PayFrame>;
  if (!data) return <PayFrame><div className={cardCls} aria-busy="true"><Skeleton className="h-3.5 w-[40%]" /><Skeleton className="mt-[18px] h-10 w-[60%]" /><Skeleton className="mt-7 h-[120px] w-full" /></div></PayFrame>;
  return <PayFrame testMode={data.test_mode} networkName={data.pay.network.name}><PayCard view={data} token={token} refresh={mutate} /></PayFrame>;
}

function PayFrame({ children, testMode, networkName }: { children: React.ReactNode; testMode?: boolean; networkName?: string }) {
  return <div className="min-h-screen bg-background">{testMode && <div className="flex items-center justify-center gap-2 border-b border-warning/25 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning"><FlaskConical className="size-3.5 shrink-0" /> Test payment page on {networkName ?? "NEAR"}. Test tokens only.</div>}<main id="main" className="mx-auto max-w-[480px] px-4 pt-14 pb-12 max-sm:pt-5">{children}<p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground"><Lock className="mr-1 inline size-3 align-[-2px]" /> Payments go directly to the merchant&rsquo;s NEAR wallet. Powered by <a href="/?from=payment-page" target="_blank" rel="noopener" className="font-semibold text-foreground/70 hover:underline">Zetra</a></p></main></div>;
}

function PayCard({ view, token, refresh }: { view: PublicView; token: string; refresh: () => void }) {
  const { invoice, pay, state } = view;
  const settled = state === "paid" || state === "overpaid";
  const [whole, cents] = moneyParts(settled ? invoice.amount_paid : state === "partially_paid" ? invoice.amount_remaining : invoice.amount_due);
  const latest = view.payments.at(-1);
  useEffect(() => { document.title = `Pay ${view.merchant.name} · ${invoice.number}`; }, [view.merchant.name, invoice.number]);
  return <div className={cn(cardCls, "animate-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none")}><div className="flex items-center gap-3 border-b pb-5"><span className="grid size-10 place-items-center rounded-[11px] bg-gradient-to-br from-primary to-[#2365de] text-[17px] font-bold text-primary-foreground shadow-[0_5px_16px_var(--brand-soft)]">{view.merchant.name.slice(0, 1)}</span><div><div className="text-[0.9375rem] font-semibold tracking-[-0.015em]">{view.merchant.name}</div><div className="text-sm text-muted-foreground">Invoice <span className="font-mono text-[0.92em]">{invoice.number}</span></div></div></div>
    {settled ? <section className="grid justify-items-center gap-1.5 pt-7 pb-2 text-center" role="status"><CheckCircle2 className="size-12 text-success" /><h1 className={titleCls}>Payment received</h1><Amount whole={whole} cents={cents} unit={pay.asset.symbol} />{invoice.title && <p className="mt-1.5 font-medium text-foreground/80">for {invoice.title}</p>}<p className="text-muted-foreground">You&rsquo;re all set. {view.merchant.name} has been notified.</p>{view.payments.some((p) => p.review_only) && <p className="mt-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">An additional transfer reached the merchant wallet and is being reviewed. It was not applied to this invoice. Contact the merchant if you need a refund.</p>}{latest?.explorer_url && <Button asChild variant="secondary" size="sm" className="mt-3.5"><a href={latest.explorer_url} target="_blank" rel="noreferrer noopener">View transaction <ExternalLink /></a></Button>}</section>
      : state === "cancelled" || state === "expired" ? <section className="grid justify-items-center gap-2.5 pt-7 pb-2 text-center">{state === "cancelled" ? <XCircle className="size-7 text-muted-foreground" /> : <Clock className="size-7 text-muted-foreground" />}<h1 className={titleCls}>{state === "cancelled" ? "This payment request was cancelled" : "This payment request has expired"}</h1><p className="text-muted-foreground">Please don&rsquo;t send funds to this request. Contact {view.merchant.name}{view.merchant.support_email ? ` at ${view.merchant.support_email}` : ""} for a new one.</p></section>
      : <><section className="pt-[22px] pb-1.5"><h1 className="m-0 text-[1.375rem] leading-tight font-semibold tracking-[-0.022em] break-words">{invoice.title ?? `Invoice ${invoice.number}`}</h1>{invoice.purpose && <p className="mt-1.5 text-foreground/80">{invoice.purpose}</p>}{invoice.line_items.length > 0 && <div aria-label="What you are paying for" className="mt-3.5"><LineItems className="mt-0" items={invoice.line_items} total={invoice.amount_due} /></div>}<div className="mt-[18px] text-sm text-muted-foreground">{state === "partially_paid" ? "Remaining balance" : "Amount due"}</div><Amount whole={whole} cents={cents} />{Number(invoice.tax_amount ?? 0) > 0 && <div className="mt-1 text-sm text-muted-foreground">Includes {money(invoice.tax_amount!)} tax</div>}<dl className="mt-4 flex flex-wrap gap-6"><div><dt className="text-xs text-muted-foreground">Billed to</dt><dd className="mt-0.5 font-medium">{invoice.customer_name}</dd></div>{invoice.due_at && <div><dt className="text-xs text-muted-foreground">Due</dt><dd className="mt-0.5 font-medium">{dateShort(invoice.due_at)}</dd></div>}</dl></section>{state === "confirming" ? <div className="mt-5 flex items-start gap-3 rounded-2xl bg-info/10 px-4 py-3.5" role="status"><Spinner className="mt-[3px] text-info" /><div><strong className="font-semibold">Payment detected</strong><div className="text-sm text-muted-foreground">{money(invoice.amount_confirming)} {pay.asset.symbol} seen on {pay.network.name}. Waiting for finality.</div></div></div> : <PaymentMethods view={view} token={token} refresh={refresh} />}</>}
  </div>;
}

function Amount({ whole, cents, unit }: { whole: string; cents: string; unit?: string }) { return <div className="tabular mt-1 text-5xl leading-[1.1] font-semibold tracking-[-0.035em] max-sm:text-[2.4rem]">{whole}<span className="text-muted-foreground/70">{cents}</span>{unit && <span className="ml-1.5 text-[1.3rem] font-medium tracking-[-0.01em] text-muted-foreground">{unit}</span>}</div>; }

function PaymentMethods({ view, token, refresh }: { view: PublicView; token: string; refresh: () => void }) {
  const [method, setMethod] = useState<"wallet" | "manual">("wallet");
  const { pay } = view;
  return <div className="mt-5 border-t pt-5"><div className="grid grid-cols-2 gap-2.5"><div className="grid gap-[3px] rounded-[14px] bg-muted px-3.5 py-3 text-sm"><span className="text-muted-foreground">Pay with</span><strong className="font-semibold">{pay.asset.symbol}</strong></div><div className="grid gap-[3px] rounded-[14px] bg-muted px-3.5 py-3 text-sm"><span className="text-muted-foreground">Network</span><strong className="flex items-center gap-1.5 font-semibold"><ChainMark network="near" /> {pay.network.name}</strong></div></div><Segmented className="mt-4 [&_[role=tablist]]:w-full" label="Payment method" value={method} onChange={setMethod} options={[{ value: "wallet", label: <><Wallet className="size-3.5" /> NEAR wallet</> }, { value: "manual", label: <><QrCode className="size-3.5" /> Send manually</> }]} /><div key={method} className="animate-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">{method === "wallet" ? <NearWalletCheckout pay={pay} token={token} onSubmitted={refresh} /> : <ManualInstructions pay={pay} />}</div>{view.test_mode && <SimulateButton token={token} onDone={refresh} />}</div>;
}

function ManualInstructions({ pay }: { pay: NearPay }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { QRCode.toDataURL(typeof window === "undefined" ? "" : window.location.href, { margin: 1, width: 360, color: { dark: "#0b1422", light: "#ffffff" } }).then(setQr).catch(() => setQr(null)); }, []);
  return <div className="mt-4"><p className="mb-3 text-sm text-muted-foreground">Send the payment from any NEAR wallet. Use the exact token, recipient, amount, and memo below. This page updates when the payment reaches finality.</p><div className="grid items-start gap-4 sm:grid-cols-[148px_minmax(0,1fr)] max-sm:justify-items-center">{qr && <img src={qr} alt={`QR code to pay ${pay.amount} ${pay.asset.symbol}`} width={148} height={148} className="rounded-[14px] shadow-card [image-rendering:pixelated]" />}<div className="grid w-full min-w-0 gap-3"><Copyable label="1. Send exactly" value={`${money(pay.amount, { currency: false })} ${pay.asset.symbol}`} copyValue={pay.amount} /><Copyable label="2. To this NEAR account" value={pay.recipient} mono /><Copyable label={`${pay.asset.symbol} token contract`} value={pay.asset.address} mono /><Copyable label="Payment memo" value={pay.payment_memo} mono /></div></div><p className="mt-3.5 rounded-xl bg-warning/10 px-3 py-2.5 text-xs text-warning">Send {pay.asset.symbol} on {pay.network.name} only. Other tokens will not be credited automatically.</p></div>;
}

function Copyable({ label, value, copyValue, mono }: { label: string; value: string; copyValue?: string; mono?: boolean }) { const [done, setDone] = useState(false); return <div className="min-w-0"><div className={fieldLabelCls}>{label}</div><button type="button" className={cn("flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl bg-muted px-3 py-2.5 font-semibold transition-colors hover:bg-accent", mono && "font-mono text-xs font-medium")} onClick={async () => { await navigator.clipboard.writeText(copyValue ?? value).catch(() => undefined); setDone(true); setTimeout(() => setDone(false), 1400); }}><span className="min-w-0 flex-1 truncate text-left">{value}</span>{done ? <CheckCircle2 className="size-3.5 text-success" /> : <span className="font-sans text-[11px] text-muted-foreground">Copy</span>}</button></div>; }

function SimulateButton({ token, onDone }: { token: string; onDone: () => void }) { const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); return <div className="mt-[18px] border-t pt-3.5 text-center"><Button variant="ghost" size="sm" className="h-auto min-h-8 text-xs whitespace-normal text-muted-foreground" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await publicCall(`/v1/public/payment-requests/${token}/simulate`, "POST"); onDone(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>{busy ? <Spinner /> : <FlaskConical />} Simulate a test payment (no funds move)</Button>{error && <p className="mt-2 text-sm text-destructive">{error}</p>}</div>; }

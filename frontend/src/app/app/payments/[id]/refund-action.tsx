"use client";

import { useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { AlertCircle, CheckCircle2, RotateCcw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/session";
import { api, newIdempotencyKey } from "@/lib/api";
import { money, shortAddress } from "@/lib/format";

type RefundPayment = {
  id: string;
  status: string;
  amount: string;
  amount_base_units: string;
  network_id: string;
  network_name: string;
  testnet: boolean;
  sender: string;
  source: string;
  simulated: boolean;
  asset: { symbol: string; decimals: number; address: string };
  wallet: { address: string };
};

type RefundRequest = { id: string; amount_base_units: string; recipient: string; memo: string | null; status: string };
type RefundStage = "idle" | "connecting" | "preparing" | "signing" | "verifying" | "done";

function failedExecution(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const result = value as Record<string, unknown>;
  const outcomes = [result.transaction_outcome, ...(Array.isArray(result.receipts_outcome) ? result.receipts_outcome : [])];
  return outcomes.some((item) => {
    if (!item || typeof item !== "object") return true;
    const outcome = (item as Record<string, unknown>).outcome as Record<string, unknown> | undefined;
    const status = outcome?.status as Record<string, unknown> | undefined;
    return !status || "Failure" in status;
  });
}

export function RefundAction({ payment, onConfirmed }: { payment: RefundPayment; onConfirmed: () => void }) {
  const { can } = useSession();
  const [connector, setConnector] = useState<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState(payment.amount);
  const [stage, setStage] = useState<RefundStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<RefundRequest | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const network = payment.testnet ? "testnet" : "mainnet";
  const allowed = !payment.simulated && payment.source !== "simulated" && ["matched", "partial", "overpaid", "needs_review", "dismissed"].includes(payment.status);
  const authorized = can("financials:write") && can("financials:approve");

  const connect = async () => {
    setStage("connecting");
    setError(null);
    try {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const next = new NearConnector({ network, autoConnect: false, features: { signAndSendTransaction: true }, footerBranding: null });
      const wallet = await next.connect();
      const accounts = await wallet.getAccounts({ network });
      const account = accounts[0]?.accountId;
      if (!account) throw new Error("The wallet did not share an account. Unlock it and try again.");
      if (account.toLowerCase() !== payment.wallet.address.toLowerCase()) {
        throw new Error(`Connect the business receiving wallet ${payment.wallet.address}. Refunds are signed by the business wallet that received the payment.`);
      }
      setConnector(next);
      setAccountId(account);
    } catch (err) {
      setError((err as Error).message || "Could not connect the business wallet.");
    } finally {
      setStage("idle");
    }
  };

  const recordRefund = async (refund: RefundRequest, hash: string) => {
    setStage("verifying");
    setError(null);
    try {
      await api(`/v1/payouts/${refund.id}/confirm-wallet`, {
        method: "POST",
        body: { transaction_hash: hash },
        idempotencyKey: `${idempotencyKey}:confirm`
      });
      setStage("done");
      setTransactionHash(hash);
      onConfirmed();
    } catch (err) {
      setStage("idle");
      setTransactionHash(hash);
      setError(`The wallet transaction was submitted, but Zetra could not record its finalized evidence yet: ${(err as Error).message}. Retry verification below; do not send the refund again.`);
    }
  };

  const submitRefund = async () => {
    if (!connector || !accountId) return;
    setStage("preparing");
    setError(null);
    try {
      let refund = request;
      if (!refund) {
        refund = await api<RefundRequest>(`/v1/payments/${payment.id}/refund`, {
          method: "POST",
          body: { amount, memo: `Refund for ${payment.id}`, idempotency_key: idempotencyKey },
          idempotencyKey
        });
        setRequest(refund);
      }
      setStage("signing");
      const wallet = await connector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        network,
        signerId: accountId,
        receiverId: payment.asset.address,
        actions: [{
          type: "FunctionCall",
          params: {
            methodName: "ft_transfer",
            args: { receiver_id: payment.sender, amount: refund.amount_base_units, memo: refund.memo ?? `Refund for ${payment.id}` },
            gas: "100000000000000",
            deposit: "1"
          }
        }]
      });
      if (failedExecution(outcome)) throw new Error("NEAR reported a failed refund transfer. Zetra has not recorded it as refunded.");
      const hash = outcome && typeof outcome === "object" && (outcome as Record<string, any>).transaction?.hash;
      if (typeof hash !== "string" || !hash) throw new Error("The wallet returned no transaction hash. Check wallet history before retrying.");
      setTransactionHash(hash);
      await recordRefund(refund, hash);
    } catch (err) {
      setStage("idle");
      setError((err as Error).message || "The refund was not completed.");
    }
  };

  if (!allowed || !authorized) return null;
  if (stage === "done" && transactionHash) return <div className="rounded-xl bg-success/10 px-3 py-2.5 text-sm text-success" role="status"><CheckCircle2 className="mr-1 inline size-4" /> Refund finalized and recorded. Transaction: <span className="font-mono">{shortAddress(transactionHash)}</span></div>;

  return <div className="grid gap-3 rounded-2xl border p-4">
    <div><h3 className="font-semibold">Refund this payment</h3><p className="mt-1 text-sm text-muted-foreground">Send USDC from the business wallet back to the original payer. Zetra never signs or holds the business wallet key.</p></div>
    <label className="grid gap-1 text-sm">Refund amount ({payment.asset.symbol})<input className="h-10 rounded-xl border bg-background px-3 font-mono" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={!!request || stage !== "idle"} /></label>
    <div className="grid gap-1 rounded-xl bg-muted px-3 py-2.5 text-xs"><span className="text-muted-foreground">Refund destination · original payer</span><span className="break-all font-mono">{payment.sender}</span><span className="mt-1 text-muted-foreground">Refund source · business receiving wallet</span><span className="break-all font-mono">{payment.wallet.address}</span></div>
    {accountId ? <div className="rounded-xl bg-muted px-3 py-2 text-sm">Business wallet connected: <span className="font-mono">{shortAddress(accountId)}</span></div> : null}
    {transactionHash && stage !== "done" ? <Button variant="secondary" onClick={() => request && recordRefund(request, transactionHash)} disabled={stage !== "idle"}><RotateCcw /> Retry verification (do not resend)</Button> : accountId ? <Button onClick={submitRefund} disabled={stage !== "idle" || (!!request && !!transactionHash)}><Wallet />{stage === "preparing" ? "Preparing refund…" : stage === "signing" ? "Confirm in your wallet…" : stage === "verifying" ? "Verifying finality…" : `Refund ${money(amount, { currency: false })} ${payment.asset.symbol}`}</Button> : <Button variant="secondary" onClick={connect} disabled={stage !== "idle"}><Wallet />{stage === "connecting" ? "Connecting…" : "Connect business wallet"}</Button>}
    {error && <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert"><AlertCircle className="mr-1 inline size-4" />{error}</p>}
    <p className="text-xs text-muted-foreground">Your wallet will show the token contract and payer address. Review the amount before signing. NEAR is needed for gas.</p>
  </div>;
}

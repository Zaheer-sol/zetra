"use client";

import { useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { AlertCircle, CheckCircle2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/app-ui";
import { money, shortAddress } from "@/lib/format";

interface NearPay {
  network: { id: string; name: string; family: "near"; testnet: boolean; explorer_url: string | null; native_symbol: string; rpc_url: string };
  asset: { id: string; symbol: string; name: string; address: string; decimals: number };
  recipient: string;
  amount: string;
  amount_base_units: string;
  payment_memo: string;
}

type Stage = { kind: "idle" } | { kind: "working"; label: string } | { kind: "submitted"; hash: string } | { kind: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failedExecution(outcome: unknown): boolean {
  if (!isRecord(outcome)) return true;
  const executions = [outcome.transaction_outcome, ...(Array.isArray(outcome.receipts_outcome) ? outcome.receipts_outcome : [])];
  return executions.some((execution) => {
    if (!isRecord(execution) || !isRecord(execution.outcome) || !isRecord(execution.outcome.status)) return true;
    return "Failure" in execution.outcome.status;
  });
}

export default function NearWalletCheckout({ pay, onSubmitted }: { pay: NearPay; onSubmitted: () => void }) {
  const [connector, setConnector] = useState<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const busy = stage.kind === "working";
  const network = pay.network.testnet ? "testnet" : "mainnet";

  const connect = async () => {
    setStage({ kind: "working", label: `Connecting to ${pay.network.name}…` });
    try {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const next = new NearConnector({
        network,
        autoConnect: false,
        features: { signAndSendTransaction: true },
        footerBranding: null
      });
      const wallet = await next.connect();
      const accounts = await wallet.getAccounts({ network });
      const account = accounts[0]?.accountId;
      if (!account) throw new Error("The wallet did not share an account. Unlock it and try again.");
      setConnector(next);
      setAccountId(account);
      setStage({ kind: "idle" });
    } catch (error) {
      setStage({ kind: "error", message: (error as Error).message || "The wallet connection was not completed." });
    }
  };

  const payNow = async () => {
    if (!connector || !accountId) return;
    setStage({ kind: "working", label: "Confirm the USDC transfer in your NEAR wallet…" });
    try {
      const wallet = await connector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        network,
        signerId: accountId,
        receiverId: pay.asset.address,
        actions: [{
          type: "FunctionCall",
          params: {
            methodName: "ft_transfer",
            args: {
              receiver_id: pay.recipient,
              amount: pay.amount_base_units,
              memo: pay.payment_memo
            },
            gas: "30000000000000",
            deposit: "1"
          }
        }]
      });
      if (failedExecution(outcome)) throw new Error("The token transfer failed on NEAR. No payment was recorded.");
      const transactionHash = isRecord(outcome) && isRecord(outcome.transaction) && typeof outcome.transaction.hash === "string"
        ? outcome.transaction.hash
        : null;
      if (!transactionHash) throw new Error("NEAR did not return a transaction hash. Check your wallet before retrying.");
      setStage({ kind: "submitted", hash: transactionHash });
      onSubmitted();
    } catch (error) {
      setStage({ kind: "error", message: (error as Error).message || "The transfer was not completed." });
    }
  };

  return (
    <div className="mt-4 grid gap-3">
      <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm">
        <div className="text-xs text-muted-foreground">Business receives at</div>
        <div className="mt-1 break-all font-mono text-xs font-medium">{pay.recipient}</div>
        <p className="mt-2 text-xs text-muted-foreground">
          The wallet may show the USDC token contract as the transaction destination. The transfer recipient is the business address above.
        </p>
      </div>
      {accountId ? (
        <>
          <div className="rounded-xl bg-muted px-3 py-2.5 text-sm">
            Connected as <span className="font-mono font-medium">{shortAddress(accountId)}</span>
          </div>
          <Button size="lg" className="w-full" onClick={payNow} disabled={busy || stage.kind === "submitted"}>
            {busy ? <Spinner /> : <Wallet aria-hidden="true" />}
            {busy ? stage.label : `Pay ${money(pay.amount, { currency: false })} ${pay.asset.symbol}`}
          </Button>
        </>
      ) : (
        <Button size="lg" className="w-full" onClick={connect} disabled={busy}>
          {busy ? <Spinner /> : <Wallet aria-hidden="true" />}
          {busy ? stage.label : "Connect NEAR wallet"}
        </Button>
      )}
      {stage.kind === "submitted" && (
        <p className="text-sm text-muted-foreground" role="status">
          <CheckCircle2 className="mr-1 inline size-4 text-success" aria-hidden="true" />
          Transfer submitted. Waiting for the payment page to update.
          {pay.network.explorer_url && (
            <>{" "}<a className="font-medium text-primary hover:underline" href={`${pay.network.explorer_url}/txns/${stage.hash}`} target="_blank" rel="noreferrer">View transaction</a></>
          )}
        </p>
      )}
      {stage.kind === "error" && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
          <AlertCircle className="mr-1 inline size-4" aria-hidden="true" />{stage.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Your wallet will show the token contract, recipient, amount, and invoice reference before you approve. A small amount of NEAR is needed for network fees.
      </p>
    </div>
  );
}

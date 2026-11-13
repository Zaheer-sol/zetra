"use client";

import { useEffect, useState } from "react";
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

type Stage = { kind: "idle" } | { kind: "working"; label: string } | { kind: "submitted"; hash: string; amountBaseUnits: string; verification: "verified" | "pending" | "mismatch"; message: string } | { kind: "error"; message: string };
type SavedSubmission = { version: 1; payer_account_id: string; transaction_hash: string };
interface Preflight {
  network: string;
  token_contract: string;
  payer_account_id: string;
  recipient_account_id: string;
  payer_exists: boolean;
  payer_near_balance_yocto: string | null;
  payer_token_registered: boolean;
  recipient_token_registered: boolean;
  token_storage_minimum_yocto: string;
  payer_token_balance_base_units: string;
  amount_required_base_units: string;
  registration_deposit_required_yocto: string;
  gas_reserve_yocto: string;
  can_pay: boolean;
  environment: string;
}

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

function recoveryKey(token: string) {
  return `zetra:near-payment:v1:${token}`;
}

function readSubmission(token: string): SavedSubmission | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(recoveryKey(token)) ?? "null") as SavedSubmission | null;
    return saved?.version === 1 && typeof saved.payer_account_id === "string" && /^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(saved.transaction_hash) ? saved : null;
  } catch {
    return null;
  }
}

function saveSubmission(token: string, payer: string, hash: string) {
  try { window.localStorage.setItem(recoveryKey(token), JSON.stringify({ version: 1, payer_account_id: payer, transaction_hash: hash } satisfies SavedSubmission)); } catch { /* The payer can still paste the hash from wallet history. */ }
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function NearWalletCheckout({ pay, token, onSubmitted }: { pay: NearPay; token: string; onSubmitted: () => void }) {
  const [connector, setConnector] = useState<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [existingHash, setExistingHash] = useState("");
  const [savedSubmission, setSavedSubmission] = useState<SavedSubmission | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const busy = stage.kind === "working";
  const network = pay.network.testnet ? "testnet" : "mainnet";

  useEffect(() => {
    const saved = readSubmission(token);
    setSavedSubmission(saved);
    if (saved) setExistingHash(saved.transaction_hash);
  }, [token]);

  useEffect(() => {
    // After a verified partial payment, the hosted page changes to the new remaining amount.
    // Reset wallet readiness so the payer can safely pay that balance as a second transfer.
    if (stage.kind === "submitted" && stage.verification === "verified" && stage.amountBaseUnits !== pay.amount_base_units) {
      setStage({ kind: "idle" });
      setPreflight(null);
    }
  }, [pay.amount_base_units, stage]);

  const checkReadiness = async (payer: string) => {
    const response = await fetch(`/api/v1/public/payment-requests/${encodeURIComponent(token)}/preflight`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ payer_account_id: payer }),
      cache: "no-store"
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message ?? "Could not check testnet USDC readiness. Please retry.");
    const result = data as Preflight;
    setPreflight(result);
    return result;
  };

  const verifySubmitted = async (hash: string, payer = accountId): Promise<"verified" | "pending" | "mismatch"> => {
    if (!payer) {
      setStage({ kind: "submitted", hash, amountBaseUnits: pay.amount_base_units, verification: "pending", message: "Reconnect the payer wallet used for this transfer before Zetra can verify it. Do not send a second payment." });
      return "pending";
    }
    setStage({ kind: "working", label: "Verifying the finalized NEAR transfer…" });
    try {
      const response = await fetch(`/api/v1/public/payment-requests/${encodeURIComponent(token)}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ payer_account_id: payer, transaction_hash: hash }),
        cache: "no-store"
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const definitive = response.status === 400 || response.status === 404 || response.status === 422;
        if (definitive) {
          try { window.localStorage.removeItem(recoveryKey(token)); } catch { /* Ignore storage restrictions. */ }
          setSavedSubmission(null);
        }
        setStage({
          kind: "submitted",
          hash,
          amountBaseUnits: pay.amount_base_units,
          verification: definitive ? "mismatch" : "pending",
          message: data?.error?.message ?? "Zetra could not verify this transaction yet."
        });
        onSubmitted();
        return definitive ? "mismatch" : "pending";
      }
      const state = data?.verification?.invoice_state as string | undefined;
      const paymentStatuses = (data?.verification?.payment_statuses ?? []) as string[];
      const heldForReview = paymentStatuses.includes("needs_review");
      const applied = paymentStatuses.some((status) => ["matched", "partial", "overpaid"].includes(status));
      const message = heldForReview
        ? "Finalized transfer verified and received by the business wallet, but held for review because the invoice was already paid. Contact the merchant if this was an extra payment."
        : applied
        ? "Finalized transfer verified and applied to this invoice."
        : state === "partially_paid"
          ? "Transfer verified and applied. The invoice now shows its remaining balance."
          : "Transfer verified on NEAR, but it did not settle this invoice automatically. The business may need to review the payment.";
      setStage({ kind: "submitted", hash, amountBaseUnits: pay.amount_base_units, verification: "verified", message });
      try { window.localStorage.removeItem(recoveryKey(token)); } catch { /* Ignore storage restrictions. */ }
      setSavedSubmission(null);
      onSubmitted();
      return "verified";
    } catch {
      setStage({
        kind: "submitted",
        hash,
        amountBaseUnits: pay.amount_base_units,
        verification: "pending",
        message: "NEAR verification is temporarily unavailable. Keep this page open and check again. Do not send a second payment."
      });
      onSubmitted();
      return "pending";
    }
  };

  const verifyWithRetries = async (hash: string, payer = accountId) => {
    if (!payer) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await verifySubmitted(hash, payer);
      if (result !== "pending" || attempt === 4) return;
      await pause(1_250);
    }
  };

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
      const saved = readSubmission(token);
      if (saved && saved.payer_account_id.toLowerCase() !== account.toLowerCase()) {
        setSavedSubmission(saved);
        setExistingHash(saved.transaction_hash);
        throw new Error(`A payment from ${saved.payer_account_id} is still being verified. Connect that same payer wallet to recover it; do not send another payment.`);
      }
      setConnector(next);
      setAccountId(account);
      if (saved) {
        setSavedSubmission(saved);
        setExistingHash(saved.transaction_hash);
        saveSubmission(token, account, saved.transaction_hash);
        await verifyWithRetries(saved.transaction_hash, account);
      } else {
        setStage({ kind: "working", label: "Checking testnet USDC and NEAR balances…" });
        await checkReadiness(account);
        setStage({ kind: "idle" });
      }
    } catch (error) {
      setStage({ kind: "error", message: (error as Error).message || "The wallet connection was not completed." });
    }
  };

  const payNow = async () => {
    if (!connector || !accountId) return;
    setStage({ kind: "working", label: "Rechecking balances and preparing your payment…" });
    try {
      const ready = await checkReadiness(accountId);
      if (!ready.payer_exists) throw new Error(`Your ${network} account ${accountId} does not exist yet. Create/fund that testnet account first.`);
      if (BigInt(ready.payer_token_balance_base_units) < BigInt(ready.amount_required_base_units)) {
        throw new Error(`Not enough ${pay.asset.symbol} in ${accountId}. This invoice needs ${money(pay.amount, { currency: false })} ${pay.asset.symbol}; the connected wallet has ${formatUnits(ready.payer_token_balance_base_units, pay.asset.decimals)} ${pay.asset.symbol}.`);
      }
      const requiredNear = BigInt(ready.registration_deposit_required_yocto) + BigInt(ready.gas_reserve_yocto);
      if (BigInt(ready.payer_near_balance_yocto ?? "0") < requiredNear) {
        throw new Error(`Not enough NEAR for network gas and token-account registration. This payment needs about ${formatNear(requiredNear.toString())} NEAR available; the wallet has ${formatNear(ready.payer_near_balance_yocto ?? "0")} NEAR.`);
      }
      const wallet = await connector.wallet();
      const actions: Array<{ type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }> = [];
      const registered = new Set<string>();
      const storageMinimum = ready.token_storage_minimum_yocto;
      const register = (account: string) => {
        if (registered.has(account)) return;
        registered.add(account);
        actions.push({ type: "FunctionCall", params: { methodName: "storage_deposit", args: { account_id: account, registration_only: true }, gas: "30000000000000", deposit: storageMinimum } });
      };
      if (!ready.payer_token_registered) register(accountId);
      if (!ready.recipient_token_registered) register(ready.recipient_account_id);
      actions.push({
        type: "FunctionCall",
        params: {
          methodName: "ft_transfer",
          args: { receiver_id: ready.recipient_account_id, amount: pay.amount_base_units, memo: pay.payment_memo },
          gas: "30000000000000",
          deposit: "1"
        }
      });
      setStage({ kind: "working", label: "Confirm the USDC transfer in your NEAR wallet…" });
      const outcome = await wallet.signAndSendTransaction({
        network,
        signerId: accountId,
        receiverId: pay.asset.address,
        actions
      });
      if (failedExecution(outcome)) throw new Error("The token transfer failed on NEAR. No payment was recorded.");
      const transactionHash = isRecord(outcome) && isRecord(outcome.transaction) && typeof outcome.transaction.hash === "string"
        ? outcome.transaction.hash
        : null;
      if (!transactionHash) throw new Error("NEAR did not return a transaction hash. Check your wallet before retrying.");
      saveSubmission(token, accountId, transactionHash);
      setSavedSubmission({ version: 1, payer_account_id: accountId, transaction_hash: transactionHash });
      setExistingHash(transactionHash);
      onSubmitted();
      await verifyWithRetries(transactionHash, accountId);
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
          {preflight && <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed" role="status">
            <div>Wallet balance: <strong>{formatUnits(preflight.payer_token_balance_base_units, pay.asset.decimals)} {pay.asset.symbol}</strong> · <strong>{formatNear(preflight.payer_near_balance_yocto ?? "0")} NEAR</strong></div>
            {!preflight.payer_token_registered && <div className="mt-1 text-warning">Your token account will be registered in the payment transaction.</div>}
            {!preflight.recipient_token_registered && <div className="mt-1 text-warning">The business token account will be registered in the same transaction. Its storage deposit is included below.</div>}
            {preflight.registration_deposit_required_yocto !== "0" && <div className="mt-1">Token storage deposit: {formatNear(preflight.registration_deposit_required_yocto)} NEAR, plus network gas.</div>}
          </div>}
          {preflight && !preflight.can_pay && <p className="rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning" role="alert">
            {!preflight.payer_exists
              ? `This ${network} account does not exist yet. Create and fund it before paying.`
              : BigInt(preflight.payer_token_balance_base_units) < BigInt(preflight.amount_required_base_units)
                ? `This invoice needs ${money(pay.amount, { currency: false })} ${pay.asset.symbol}; this wallet has ${formatUnits(preflight.payer_token_balance_base_units, pay.asset.decimals)} ${pay.asset.symbol}. Get test USDC into this wallet before paying.`
                : `This payment needs about ${formatNear((BigInt(preflight.registration_deposit_required_yocto) + BigInt(preflight.gas_reserve_yocto)).toString())} NEAR for gas and token-account registration; this wallet has ${formatNear(preflight.payer_near_balance_yocto ?? "0")} NEAR.`}
          </p>}
          <Button size="lg" className="w-full" onClick={payNow} disabled={busy || stage.kind === "submitted"}>
            {busy ? <Spinner /> : <Wallet aria-hidden="true" />}
            {busy ? stage.label : !preflight ? "Retry wallet check" : preflight.can_pay ? `Pay ${money(pay.amount, { currency: false })} ${pay.asset.symbol}` : "Check wallet balances"}
          </Button>
          {stage.kind !== "submitted" && (
            <details className="rounded-xl border px-3 py-2.5 text-sm">
              <summary className="cursor-pointer font-medium">Already sent USDC? Verify the transaction</summary>
              <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); if (existingHash.trim()) { saveSubmission(token, accountId, existingHash.trim()); void verifyWithRetries(existingHash.trim(), accountId); } }}>
                <label className="text-xs text-muted-foreground" htmlFor="existing-near-tx">Final NEAR transaction hash</label>
                <input
                  id="existing-near-tx"
                  value={existingHash}
                  onChange={(event) => setExistingHash(event.target.value.trim())}
                  placeholder="Paste the hash from your wallet"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full min-w-0 rounded-xl border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">Zetra checks the finalized NEAR transfer before recording it. It never trusts the pasted hash by itself.</p>
                <Button type="submit" size="sm" variant="secondary" disabled={busy || !existingHash.trim()}>
                  {busy ? <Spinner /> : null} Verify transaction
                </Button>
              </form>
            </details>
          )}
        </>
      ) : (
        <Button size="lg" className="w-full" onClick={connect} disabled={busy}>
          {busy ? <Spinner /> : <Wallet aria-hidden="true" />}
          {busy ? stage.label : "Connect NEAR wallet"}
        </Button>
      )}
      {savedSubmission && stage.kind !== "submitted" && stage.kind !== "working" && (
        <p className="rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning" role="status">
          A submitted payment from <span className="font-mono">{shortAddress(savedSubmission.payer_account_id)}</span> is saved in this browser. Reconnect that payer wallet to resume verification; do not pay again.
        </p>
      )}
      {stage.kind === "submitted" && (
        <div className="grid gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm" role="status">
          <p className={stage.verification === "verified" ? "text-foreground" : stage.verification === "pending" ? "text-warning" : "text-destructive"}>
            {stage.verification === "verified" ? <CheckCircle2 className="mr-1 inline size-4 text-success" aria-hidden="true" /> : <AlertCircle className="mr-1 inline size-4" aria-hidden="true" />}
            {stage.message}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {pay.network.explorer_url && <a className="font-medium text-primary hover:underline" href={`${pay.network.explorer_url}/txns/${stage.hash}`} target="_blank" rel="noreferrer noopener">View transaction</a>}
            {stage.verification === "pending" && <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-xs" onClick={() => void verifyWithRetries(stage.hash)}>Check confirmation again</Button>}
            {stage.verification === "mismatch" && <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-xs" onClick={() => setStage({ kind: "idle" })}>Return to payment options</Button>}
          </div>
        </div>
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

function formatUnits(value: string, decimals: number): string {
  const digits = value.padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function formatNear(yocto: string): string {
  return formatUnits(yocto, 24);
}

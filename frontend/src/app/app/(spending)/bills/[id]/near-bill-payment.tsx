"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConnectorAction, NearConnector } from "@hot-labs/near-connect";
import { AlertCircle, CheckCircle2, ExternalLink, RotateCcw, Wallet } from "lucide-react";
import { Button, Card } from "@/components/app-ui";
import { useSession } from "@/components/session";
import { api, newIdempotencyKey, useApi } from "@/lib/api";
import { money, shortAddress } from "@/lib/format";

type Bill = { id: string; number: string; title: string; vendor: { id: string; name: string }; status: string; amount_remaining: string; currency?: string };
type WalletRow = { id: string; name: string; address: string; network_id: string; network_name: string; testnet: boolean; is_default?: boolean; assets: Array<{ id: string; symbol: string; address: string; decimals: number }> };
type VendorAddress = { id: string; address: string; label?: string | null; network_id: string; network_name?: string };
type Vendor = { wallet_addresses: VendorAddress[] };
type Preflight = { network_id: string; network_name: string; token_contract: string; sender_account_id: string; recipient_account_id: string; token_symbol: string; amount_base_units: string; token_balance_base_units: string; sender_token_registered: boolean; recipient_token_registered: boolean; storage_deposit_yocto: string; native_balance_yocto: string | null; required_near_yocto: string; gas_reserve_yocto: string; can_pay: boolean; reason: string | null };
type Payout = { id: string; kind: string; status: string; network_id: string; recipient: string; amount_base_units: string; memo: string | null; tx_hash: string | null; error?: string | null };
type Stage = "idle" | "connecting" | "checking" | "preparing" | "signing" | "saving" | "verifying";

function pendingHashKey(payoutId: string) {
  return `zetra:vendor-payout:${payoutId}:transaction-hash`;
}

function nearAmount(yocto: string | null | undefined): string {
  if (!yocto || !/^\d+$/.test(yocto)) return "0";
  const value = BigInt(yocto);
  const whole = value / 10n ** 24n;
  const fraction = (value % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function usdcAmount(baseUnits: string): string {
  if (!/^\d+$/.test(baseUnits)) return "0.00";
  const value = BigInt(baseUnits);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

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

export function NearBillPayment({ bill, onPaid }: { bill: Bill; onPaid: () => void }) {
  const { can } = useSession();
  const { data: walletResult } = useApi<{ data: WalletRow[] }>("/v1/wallets?limit=100");
  const { data: vendor } = useApi<Vendor>(`/v1/vendors/${bill.vendor.id}`);
  const { data: payoutResult, mutate: refreshPayouts } = useApi<{ data: Payout[] }>(`/v1/payouts?bill_id=${encodeURIComponent(bill.id)}&limit=100`, { refreshInterval: 5000 });
  const [walletId, setWalletId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState(bill.amount_remaining);
  const [connector, setConnector] = useState<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wallets = walletResult?.data ?? [];
  const chosenWallet = wallets.find((wallet) => wallet.id === walletId);
  const matchingAddresses = useMemo(() => (vendor?.wallet_addresses ?? []).filter((address) => address.network_id === chosenWallet?.network_id), [vendor?.wallet_addresses, chosenWallet?.network_id]);
  const chosenAddress = matchingAddresses.find((address) => address.address === recipient);
  const recoverable = (payoutResult?.data ?? []).find((item) => item.kind === "vendor" && ["pending_approval", "approved", "submitted"].includes(item.status)) ?? null;
  const currentPayout = payout ?? recoverable;
  const authorized = can("financials:write") && can("financials:approve");
  const network = chosenWallet?.network_id.endsWith("testnet") ? "testnet" : "mainnet";

  useEffect(() => {
    if (!walletId && wallets.length) {
      const preferred = wallets.find((wallet) => wallet.is_default && wallet.network_id.startsWith("near:") && wallet.assets.some((asset) => asset.symbol === "USDC"))
        ?? wallets.find((wallet) => wallet.network_id.startsWith("near:") && wallet.assets.some((asset) => asset.symbol === "USDC"));
      if (preferred) setWalletId(preferred.id);
    }
  }, [walletId, wallets]);

  useEffect(() => {
    if (!matchingAddresses.some((address) => address.address === recipient) && matchingAddresses.length) setRecipient(matchingAddresses[0]!.address);
  }, [matchingAddresses, recipient]);

  useEffect(() => {
    if (!recoverable || recoverable.status === "submitted") return;
    const savedHash = window.localStorage.getItem(pendingHashKey(recoverable.id));
    if (savedHash && /^[A-Za-z0-9_-]{32,64}$/.test(savedHash)) {
      setPayout(recoverable);
      setSubmittedHash(savedHash);
    }
  }, [recoverable?.id, recoverable?.status]);

  const connect = async () => {
    if (!chosenWallet) return;
    setStage("connecting");
    setError(null);
    try {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const next = new NearConnector({ network, autoConnect: false, features: { signAndSendTransaction: true }, footerBranding: null });
      const walletSession = await next.connect();
      const accounts = await walletSession.getAccounts({ network });
      const account = accounts[0]?.accountId;
      if (!account) throw new Error("The wallet did not share an account. Unlock it and try again.");
      if (account.toLowerCase() !== chosenWallet.address.toLowerCase()) throw new Error(`Connect the selected business wallet ${chosenWallet.address}. The vendor payment must be signed by the wallet being debited.`);
      setConnector(next);
      setAccountId(account);
    } catch (err) {
      setError((err as Error).message || "Could not connect the business NEAR wallet.");
    } finally {
      setStage("idle");
    }
  };

  const saveAndConfirm = async (request: Payout, hash: string) => {
    setStage("saving");
    setError(null);
    try {
      const submitted = await api<Payout>(`/v1/payouts/${request.id}/submit`, { method: "POST", body: { transaction_hash: hash }, idempotencyKey: `${request.id}:${hash}:submit` });
      setPayout(submitted);
      await refreshPayouts();
      await confirm(submitted, hash);
    } catch (err) {
      setStage("idle");
      setPayout({ ...request, status: "approved" });
      setSubmittedHash(hash);
      setError(`The wallet returned transaction ${shortAddress(hash)}, but Zetra could not save or verify it yet: ${(err as Error).message}. Retry below; do not sign a second transfer.`);
    }
  };

  const confirm = async (request: Payout, hash: string) => {
    setStage("verifying");
    setError(null);
    try {
      await api(`/v1/payouts/${request.id}/confirm-wallet`, { method: "POST", body: { transaction_hash: hash }, idempotencyKey: `${request.id}:${hash}:confirm` });
      window.localStorage.removeItem(pendingHashKey(request.id));
      setStage("idle");
      setSubmittedHash(null);
      setPayout(null);
      await Promise.all([refreshPayouts(), onPaid()]);
    } catch (err) {
      setStage("idle");
      setSubmittedHash(hash);
      setError(`The transaction is saved, but NEAR finality or accounting is not confirmed yet: ${(err as Error).message}. Retry verification; do not send again.`);
    }
  };

  const pay = async () => {
    if (submittedHash && currentPayout) {
      await saveAndConfirm(currentPayout, submittedHash);
      return;
    }
    if (currentPayout?.status === "submitted" && currentPayout.tx_hash) {
      await confirm(currentPayout, currentPayout.tx_hash);
      return;
    }
    if (!chosenWallet || !chosenAddress || !connector || !accountId) return;
    setStage("checking");
    setError(null);
    try {
      let request = currentPayout;
      let ready = preflight;
      if (request?.status === "pending_approval") {
        setStage("preparing");
        request = await api<Payout>(`/v1/payouts/${request.id}/approve`, { method: "POST", body: {} });
        setPayout(request);
      }
      if (!request) {
        ready = await api<Preflight>("/v1/payouts/vendor-preflight", {
          method: "POST",
          body: { wallet_id: chosenWallet.id, bill_id: bill.id, vendor_id: bill.vendor.id, recipient: chosenAddress.address, amount }
        });
        setPreflight(ready);
        if (!ready.can_pay) throw new Error(ready.reason ?? "This wallet is not ready to pay the bill.");
        setStage("preparing");
        const idempotencyKey = newIdempotencyKey();
        request = await api<Payout>("/v1/payouts", {
          method: "POST",
          body: { kind: "vendor", wallet_id: chosenWallet.id, recipient: chosenAddress.address, amount, asset: "USDC", memo: `zetra:bill:${bill.id}`, vendor_id: bill.vendor.id, bill_id: bill.id, idempotency_key: idempotencyKey },
          idempotencyKey
        });
        request = await api<Payout>(`/v1/payouts/${request.id}/approve`, { method: "POST", body: {} });
        setPayout(request);
      }
      if (!request || request.status !== "approved") throw new Error("This payout is not approved for wallet signing yet.");
      if (!ready) {
        const resumedAmount = usdcAmount(request.amount_base_units);
        ready = await api<Preflight>("/v1/payouts/vendor-preflight", {
          method: "POST",
          body: { wallet_id: chosenWallet.id, bill_id: bill.id, vendor_id: bill.vendor.id, recipient: request.recipient, amount: resumedAmount }
        });
        setPreflight(ready);
        if (!ready.can_pay) throw new Error(ready.reason ?? "This wallet is not ready to pay the bill.");
      }
      if (request.recipient.toLowerCase() !== chosenAddress.address.toLowerCase()) throw new Error("The saved payout recipient differs from the selected vendor account. Cancel this request and prepare it again.");

      setStage("signing");
      const wallet = await connector.wallet();
      const actions: ConnectorAction[] = [];
      if (ready.storage_deposit_yocto !== "0") actions.push({ type: "FunctionCall", params: { methodName: "storage_deposit", args: { account_id: request.recipient, registration_only: true }, gas: "30000000000000", deposit: ready.storage_deposit_yocto } });
      actions.push({ type: "FunctionCall", params: { methodName: "ft_transfer", args: { receiver_id: request.recipient, amount: request.amount_base_units, memo: request.memo }, gas: "100000000000000", deposit: "1" } });
      const outcome = await wallet.signAndSendTransaction({ network, signerId: accountId, receiverId: ready.token_contract, actions });
      if (failedExecution(outcome)) throw new Error("NEAR reported that the token transfer failed. No bill payment has been recorded.");
      const hash = outcome && typeof outcome === "object" && (outcome as Record<string, any>).transaction?.hash;
      if (typeof hash !== "string" || !hash) throw new Error("The wallet returned no transaction hash. Check wallet history before signing again.");
      window.localStorage.setItem(pendingHashKey(request.id), hash);
      setSubmittedHash(hash);
      await saveAndConfirm(request, hash);
    } catch (err) {
      setStage("idle");
      setError((err as Error).message || "The vendor payment was not completed.");
    }
  };

  if (!authorized) return null;
  if (!bill.status || !["approved", "partially_paid"].includes(bill.status)) return null;

  return <Card title="Pay this vendor on NEAR" description="Send USDC from your own business wallet. Zetra records payment only after the transfer is finalized and verified.">
    <div className="grid gap-4 px-6 pb-6 max-md:px-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">Pay from business wallet
          <select className="h-11 rounded-xl border border-input bg-background px-3 font-normal" value={walletId} disabled={!!currentPayout} onChange={(event) => { setWalletId(event.target.value); setConnector(null); setAccountId(null); setPreflight(null); }}>
            {wallets.filter((wallet) => wallet.network_id.startsWith("near:") && wallet.assets.some((asset) => asset.symbol === "USDC")).map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.network_name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">Vendor NEAR account
          <select className="h-11 rounded-xl border border-input bg-background px-3 font-normal" value={recipient} onChange={(event) => { setRecipient(event.target.value); setPreflight(null); }} disabled={!matchingAddresses.length || !!currentPayout}>
            {matchingAddresses.map((address) => <option key={address.id} value={address.address}>{address.label ? `${address.label} · ` : ""}{shortAddress(address.address, 12, 8)}</option>)}
          </select>
        </label>
      </div>
      <label className="grid max-w-sm gap-1.5 text-sm font-medium">Payment amount (USDC)
        <input className="h-11 rounded-xl border border-input bg-background px-3 font-mono font-normal" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setPreflight(null); }} disabled={!!currentPayout && ["pending_approval", "approved", "submitted"].includes(currentPayout.status)} aria-describedby="near-bill-amount-help" />
      </label>
      <p id="near-bill-amount-help" className="text-xs text-muted-foreground">Up to {money(bill.amount_remaining)} remains on bill {bill.number}. Partial payment is supported.</p>

      {!wallets.length && <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">Add your business NEAR wallet in <a className="text-primary underline" href="/app/wallets">Wallets</a> and enable USDC before paying.</p>}
      {wallets.length > 0 && !matchingAddresses.length && <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">Add a NEAR receiving address to {bill.vendor.name} before paying this vendor. <a className="text-primary underline" href={`/app/vendors/${bill.vendor.id}`}>Open vendor</a>.</p>}
      {chosenWallet && accountId && <p className="rounded-xl bg-muted px-3 py-2 text-sm">Business wallet connected: <span className="font-mono">{shortAddress(accountId, 10, 8)}</span></p>}
      {preflight && <div className="grid gap-1 rounded-xl border px-3 py-3 text-sm">
        <p className="font-medium">{preflight.can_pay ? "Wallet check passed" : "Wallet needs attention"}</p>
        <p className="text-muted-foreground">USDC balance: {money(usdcAmount(preflight.token_balance_base_units), { currency: false })} USDC</p>
        <p className="text-muted-foreground">USDC token contract: <span className="break-all font-mono">{preflight.token_contract}</span></p>
        <p className="text-muted-foreground">Vendor receives at: <span className="break-all font-mono">{preflight.recipient_account_id}</span></p>
        {preflight.storage_deposit_yocto !== "0" && <p className="text-muted-foreground">NEAR token-account setup: {nearAmount(preflight.storage_deposit_yocto)} NEAR (paid once to activate the vendor token account)</p>}
        <p className="text-muted-foreground">Keep at least {nearAmount(preflight.gas_reserve_yocto)} NEAR for transaction gas. Actual gas can differ.</p>
        {preflight.reason && <p className="text-destructive" role="alert">{preflight.reason}</p>}
      </div>}
      {currentPayout && (currentPayout.status === "submitted" && currentPayout.tx_hash || submittedHash) && <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 text-sm" role="status">
        <p className="font-medium">Transfer submitted · awaiting finality verification</p>
        <a className="mt-1 inline-flex items-center gap-1 text-primary underline" href={`${currentPayout.network_id === "near:mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/txns/${currentPayout.tx_hash ?? submittedHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink className="size-3.5" aria-hidden="true" /></a>
      </div>}
      {stage === "idle" && currentPayout && submittedHash && <Button variant="primary" onClick={pay}><RotateCcw /> Recover and verify transfer</Button>}
      {stage === "idle" && currentPayout?.status === "submitted" && currentPayout.tx_hash && !submittedHash && <Button variant="primary" onClick={pay}><RotateCcw /> Verify finality</Button>}
      {stage === "idle" && currentPayout?.status !== "submitted" && !submittedHash && !accountId && matchingAddresses.length > 0 && <Button variant="secondary" onClick={connect} disabled={!chosenWallet}><Wallet /> Connect business wallet</Button>}
      {stage === "idle" && currentPayout?.status !== "submitted" && !submittedHash && accountId && matchingAddresses.length > 0 && <Button variant="primary" onClick={pay} disabled={!chosenWallet || !chosenAddress || !amount || !/^\d+(\.\d{1,6})?$/.test(amount) || /^0+(\.0+)?$/.test(amount)}><Wallet />{currentPayout?.status === "approved" ? `Resume ${money(usdcAmount(currentPayout.amount_base_units), { currency: false })} USDC payment` : `Pay ${money(amount, { currency: false })} USDC`}</Button>}
      {stage !== "idle" && <Button variant="primary" loading disabled>{stage === "connecting" ? "Connecting wallet…" : stage === "checking" ? "Checking balances…" : stage === "preparing" ? "Preparing payout…" : stage === "signing" ? "Confirm in your wallet…" : stage === "saving" ? "Saving transaction…" : "Verifying finality…"}</Button>}
      {error && <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert"><AlertCircle className="mr-1 inline size-4" aria-hidden="true" />{error}{submittedHash && currentPayout && <button className="ml-1 font-medium underline" onClick={() => void saveAndConfirm(currentPayout, submittedHash)}>Retry recording and verification (do not resend)</button>}</div>}
      <p className="text-xs text-muted-foreground"><CheckCircle2 className="mr-1 inline size-3.5" aria-hidden="true" />Your wallet signs every transfer. Zetra never holds the key or marks this bill paid from a wallet response alone.</p>
    </div>
  </Card>;
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Plus, Wallet } from "lucide-react";
import { SyncBadge } from "@/components/payment-tables";
import { useSession } from "@/components/session";
import { Alert, Button, Card, Chain, EmptyState, ErrorState, Field, fieldErrors, Input, Modal, Money, PageHeader, Select, SkeletonRows, useToast } from "@/components/app-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, newIdempotencyKey, useApi, type ApiError } from "@/lib/api";

function WalletsView() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSession();
  const [adding, setAdding] = useState(params.get("add") === "1");
  const { data, error, mutate } = useApi<{ data: any[] }>("/v1/wallets", { refreshInterval: 5000 });

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        title="Receiving wallets"
        description="Public wallet addresses Zetra monitors for incoming supported stablecoins. Funds and signing authority remain under your control."
        actions={can("wallets:write") && <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>Add wallet</Button>}
      />
      <Alert tone="neutral" title="Zetra only needs the public address">
        Keep seed phrases, private keys and signing credentials in your wallet. They never belong in Zetra.
      </Alert>
      <Card>
        {error ? (
          <ErrorState error={error} retry={() => mutate()} />
        ) : !data ? (
          <SkeletonRows rows={3} cols={5} />
        ) : data.data.length === 0 ? (
          <EmptyState icon={<Wallet />} title="Add your first wallet" mascot="focused" actions={can("wallets:write") && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>Add wallet</Button>}>
            Zetra will begin monitoring payments as soon as a receiving wallet is connected.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Wallet</TableHead>
                <TableHead className="max-md:hidden">Network</TableHead>
                <TableHead className="max-md:hidden">Assets</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right max-md:hidden">Payments</TableHead>
                <TableHead className="text-right">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((w) => (
                <TableRow key={w.id} className="cursor-pointer" tabIndex={0} onClick={() => router.push(`/app/wallets/${w.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/app/wallets/${w.id}`)}>
                  <TableCell className="max-w-[320px] whitespace-normal">
                    <span className="font-medium">{w.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{w.address}</span>
                  </TableCell>
                  <TableCell className="max-md:hidden">
                    <Chain network={w.network} name={w.network_name} />
                  </TableCell>
                  <TableCell className="max-md:hidden">{w.assets.map((a: any) => a.symbol).join(", ")}</TableCell>
                  <TableCell>
                    <SyncBadge sync={w.sync} />
                  </TableCell>
                  <TableCell className="tabular text-right max-md:hidden">{w.stats.payments}</TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money value={w.stats.total_received} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <AddWalletModal open={adding} onClose={() => setAdding(false)} onCreated={(id) => router.push(`/app/wallets/${id}`)} />
    </div>
  );
}

function AddWalletModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const { data: networkOptions } = useApi<{ data: Array<{ key: string; family: string; name: string; assets: string[] }> }>("/v1/payment-networks");
  const [form, setForm] = useState({ name: "Main Wallet", network: "near:mainnet", address: "", assets: ["USDC"] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [key] = useState(newIdempotencyKey);
  const selectedNetwork = networkOptions?.data.find((network) => network.key === form.network);
  const assets = selectedNetwork?.assets ?? [];
  useEffect(() => {
    if (networkOptions && !networkOptions.data.some((network) => network.key === form.network)) {
      const first = networkOptions.data[0];
      setForm((current) => ({ ...current, network: first?.key ?? "", assets: first?.assets.includes("USDC") ? ["USDC"] : first?.assets.slice(0, 1) ?? [] }));
    }
  }, [networkOptions, form.network]);
  const errs = fieldErrors(error);
  const valid = selectedNetwork?.family === "near"
    ? /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(form.address.trim())
    : /^0x[0-9a-fA-F]{40}$/.test(form.address.trim());
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await api<{ id: string }>("/v1/wallets", { method: "POST", idempotencyKey: key, body: { name: form.name, network: form.network, address: form.address.trim(), assets: form.assets } });
      toast("success", "Wallet added. Monitoring starts within a few seconds.");
      onCreated(w.id);
    } catch (e) {
      setError(e as ApiError);
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add receiving wallet"
      description="Zetra monitors your wallet. Your funds remain under your control."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!selectedNetwork || !valid || !form.name.trim() || !form.assets.length} onClick={submit}>Start monitoring</Button>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) submit(); }}>
        {error && !error.details && <Alert tone="danger">{error.message}</Alert>}
        <Field label="Name" htmlFor="w-name" error={errs.name}>
          <Input id="w-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Network" htmlFor="w-network">
          <Select id="w-network" value={form.network} onValueChange={(network) => {
            const selected = networkOptions?.data.find((option) => option.key === network);
            setForm((current) => ({ ...current, network, assets: selected?.assets.includes("USDC") ? ["USDC"] : selected?.assets.slice(0, 1) ?? [] }));
          }} options={(networkOptions?.data ?? []).map((network) => ({ value: network.key, label: network.name }))} />
        </Field>
        <Field label="Public address" htmlFor="w-address" error={errs.address ?? (form.address && !valid ? selectedNetwork?.family === "near" ? "Enter a valid NEAR account ID." : "Enter a 0x address with 40 hex characters." : null)} hint="Paste the address only. Never share a private key or seed phrase.">
          <Input id="w-address" className="font-mono" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="account.near" autoFocus spellCheck={false} autoComplete="off" />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium text-foreground/80">Accepted assets</legend>
          {assets.map((asset) => (
            <div className="flex items-center gap-2.5" key={asset}>
              <Checkbox id={`asset-${asset}`} checked={form.assets.includes(asset)} onCheckedChange={(checked) => setForm((current) => ({
                ...current,
                assets: checked ? [...new Set([...current.assets, asset])] : current.assets.filter((selected) => selected !== asset)
              }))} />
              <Label htmlFor={`asset-${asset}`} className="font-normal">{asset}</Label>
            </div>
          ))}
          <span className="text-xs text-muted-foreground">Other tokens sent to this wallet are recorded and flagged, they never settle an invoice.</span>
        </fieldset>
      </form>
    </Modal>
  );
}

export default function WalletsPage() {
  return (
    <Suspense>
      <WalletsView />
    </Suspense>
  );
}

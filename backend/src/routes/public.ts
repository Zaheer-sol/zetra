import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadNearNetworks, paymentNetworkById } from "@zetra/config";
import { withGlobal, withSystem, withTenant, type Client } from "@zetra/database";
import { amount, explorerTx, serializeLineItems, simulatePayment, SYSTEM } from "@zetra/engine";
import { NearRpcClient } from "@zetra/blockchain";
import { ApiError } from "../lib/errors";
import { parse } from "../lib/route";

type Row = Record<string, any>;

/**
 * The hosted payment page API. Public, unauthenticated, rate-limited, and deliberately narrow:
 * it exposes what a payer needs (merchant, amount, how to pay, status) and nothing internal,
 * no internal ids beyond the invoice number, no customer email, no other invoices.
 */
export function publicRoutes(app: FastifyInstance) {
  const limit = { rateLimit: { max: 120, timeWindow: "1 minute" } };
  const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });
  const locate = async (token: string) => {
    const hit = (await withSystem((c) => c.query("SELECT id, organization_id FROM invoices WHERE public_token = $1", [token]))).rows[0];
    if (!hit) throw new ApiError(404, "not_found", "This payment link doesn't exist. Check the link or ask the sender for a new one.");
    return hit as { id: string; organization_id: string };
  };

  app.get("/v1/public/payment-requests/:token", { config: limit, schema: { tags: ["public"], summary: "Hosted payment page data" } }, async (request) => {
    const { token } = parse(tokenParam, request.params, "path");
    const hit = await locate(token);
    return withTenant(hit.organization_id, (c) => publicView(c, hit.id));
  });

  app.post("/v1/public/payment-requests/:token/preflight", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["public"], summary: "Check NEAR testnet payer and token readiness before opening a wallet" } }, async (request) => {
    const { token } = parse(tokenParam, request.params, "path");
    const { payer_account_id } = parse(z.object({ payer_account_id: z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/) }), request.body, "body");
    const hit = await locate(token);
    return withTenant(hit.organization_id, async (c) => {
      const inv = (await c.query("SELECT i.environment, i.network_id, i.asset_id, i.wallet_id, i.amount_due, i.amount_paid, i.amount_written_off, i.status, w.address AS recipient FROM invoices i JOIN wallets w ON w.id = i.wallet_id WHERE i.id = $1", [hit.id])).rows[0] as Row;
      const network = paymentNetworkById(inv.network_id);
      const asset = network?.assets.find((candidate) => candidate.id === inv.asset_id);
      if (!network?.enabled || !asset || network.family !== "near") throw new ApiError(503, "network_unavailable", "This invoice's NEAR network or token is not enabled on this deployment.");
      if (inv.status !== "open" && inv.status !== "partially_paid") throw new ApiError(409, "payment_not_available", "This invoice is no longer accepting payments.");
      const recipient = String(inv.recipient).toLowerCase();
      const payer = payer_account_id.toLowerCase();
      const rpcNetwork = loadNearNetworks().find((candidate) => candidate.id === network.id);
      if (!rpcNetwork) throw new ApiError(503, "network_unavailable", "The configured NEAR network is unavailable.");
      const rpc = new NearRpcClient(rpcNetwork);
      let bounds: { min: string; max: string };
      let payerStorage: { total: string; available: string } | null;
      let recipientStorage: { total: string; available: string } | null;
      let tokenBalance: string;
      let nearBalance: bigint | null;
      try {
        [bounds, payerStorage, recipientStorage, tokenBalance, nearBalance] = await Promise.all([
          rpc.viewFunction<{ min: string; max: string }>(asset.contractId, "storage_balance_bounds", {}),
          rpc.viewFunction<{ total: string; available: string } | null>(asset.contractId, "storage_balance_of", { account_id: payer }),
          rpc.viewFunction<{ total: string; available: string } | null>(asset.contractId, "storage_balance_of", { account_id: recipient }),
          rpc.viewFunction<string>(asset.contractId, "ft_balance_of", { account_id: payer }),
          rpc.getAccountBalance(payer)
        ]);
      } catch {
        throw new ApiError(503, "token_preflight_unavailable", "Could not read the configured NEAR token and wallet right now. Check the testnet token contract and retry shortly.");
      }
      if (!bounds || !/^\d+$/.test(bounds.min) || !/^\d+$/.test(bounds.max)) throw new ApiError(503, "token_contract_unavailable", "The configured token contract did not return valid storage requirements.");
      const amountRemaining = BigInt(inv.amount_due) - BigInt(inv.amount_paid) - BigInt(inv.amount_written_off);
      const amountRequired = amountRemaining > 0n ? amountRemaining : 0n;
      const registrationAccounts = new Set<string>();
      if (!payerStorage) registrationAccounts.add(payer);
      if (!recipientStorage) registrationAccounts.add(recipient);
      const registrationDeposit = BigInt(bounds.min) * BigInt(registrationAccounts.size);
      // Keep a conservative gas reserve for wallet registration plus the transfer.
      const gasReserve = 10n ** 22n;
      const nearRequired = registrationDeposit + gasReserve;
      return {
        network: network.id,
        token_contract: asset.contractId,
        payer_account_id: payer,
        recipient_account_id: recipient,
        payer_exists: nearBalance !== null,
        payer_near_balance_yocto: nearBalance?.toString() ?? null,
        payer_token_registered: payerStorage !== null,
        recipient_token_registered: recipientStorage !== null,
        token_storage_minimum_yocto: bounds.min,
        payer_token_balance_base_units: tokenBalance,
        amount_required_base_units: amountRequired.toString(),
        registration_deposit_required_yocto: registrationDeposit.toString(),
        gas_reserve_yocto: gasReserve.toString(),
        can_pay: nearBalance !== null && BigInt(nearBalance) >= nearRequired && BigInt(tokenBalance) >= amountRequired,
        environment: inv.environment
      };
    });
  });

  app.post("/v1/public/payment-requests/:token/simulate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["public"], summary: "Test mode only: simulate paying this request" } }, async (request) => {
    const { token } = parse(tokenParam, request.params, "path");
    const hit = await locate(token);
    return withTenant(hit.organization_id, async (c) => {
      const inv = (await c.query("SELECT environment FROM invoices WHERE id = $1", [hit.id])).rows[0];
      if (inv.environment !== "test") throw new ApiError(403, "test_mode_only", "Simulated payments are only available for test-mode payment requests.");
      await simulatePayment(c, hit.organization_id, "test", { scenario: "exact", invoice_id: hit.id, finalize: true }, { ...SYSTEM, label: "Hosted payment page (test mode)", requestId: request.id });
      return publicView(c, hit.id);
    });
  });
}

async function publicView(c: Client, invoiceId: string) {
  const inv = (await c.query("SELECT i.*, w.address AS wallet_address, c.name AS customer_name FROM invoices i JOIN wallets w ON w.id = i.wallet_id JOIN customers c ON c.id = i.customer_id WHERE i.id = $1", [invoiceId])).rows[0] as Row;
  const org = (await withGlobal((g) => g.query("SELECT name, support_email FROM organizations WHERE id = $1", [inv.organization_id]))).rows[0] as Row;
  const network = paymentNetworkById(inv.network_id);
  if (!network) throw new ApiError(503, "network_unavailable", "This payment request's network is not configured on this deployment.");
  const asset = network.assets.find((candidate) => candidate.id === inv.asset_id);
  if (!asset) throw new ApiError(503, "asset_unavailable", "This payment request's token is not configured on this deployment.");
  const payments = (
    await c.query("SELECT * FROM payments WHERE (invoice_id = $1 OR (provisional_invoice_id = $1 AND status = 'confirming')) AND status <> 'reversed' ORDER BY block_timestamp", [invoiceId])
  ).rows as Row[];
  const lineItems = (await c.query("SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY position", [invoiceId])).rows;
  const d = asset.decimals;
  const remaining = BigInt(inv.amount_due) - BigInt(inv.amount_paid) - BigInt(inv.amount_written_off);
  const confirming = payments.filter((p) => p.status === "confirming").reduce((sum, p) => sum + BigInt(p.amount), 0n);
  const expired = inv.status === "expired" || (inv.status === "open" && inv.expires_at && new Date(inv.expires_at) < new Date());
  const state =
    inv.status === "cancelled"
      ? "cancelled"
      : inv.status === "paid"
        ? "paid"
        : inv.status === "overpaid"
          ? "overpaid"
          : confirming > 0n
            ? "confirming"
            : inv.status === "partially_paid"
              ? "partially_paid"
              : expired
                ? "expired"
                : "awaiting_payment";
  return {
    merchant: { name: org.name, support_email: org.support_email ?? null },
    invoice: {
      number: inv.number,
      title: inv.title ?? null,
      purpose: inv.purpose ?? null,
      line_items: serializeLineItems(lineItems, d),
      customer_name: inv.customer_name,
      currency: inv.currency,
      amount_due: amount(inv.amount_due, d),
      tax_amount: amount(inv.tax_amount ?? 0, d),
      amount_paid: amount(inv.amount_paid, d),
      amount_remaining: amount(remaining > 0n ? remaining : 0n, d),
      amount_confirming: amount(confirming, d),
      due_at: inv.due_at,
      expires_at: inv.expires_at,
      paid_at: inv.paid_at
    },
    state,
    test_mode: inv.environment === "test",
    pay: {
      network: { id: network.id, name: network.name, family: "near", testnet: network.environment === "test", explorer_url: network.explorerUrl ?? null, native_symbol: "NEAR", rpc_url: network.rpcUrl },
      asset: { id: asset.id, symbol: asset.symbol, name: asset.name, address: asset.contractId, decimals: asset.decimals },
      recipient: inv.wallet_address,
      amount: amount(remaining > 0n ? remaining : 0n, d),
      amount_base_units: (remaining > 0n ? remaining : 0n).toString(),
      payment_memo: `zetra:${inv.public_token}`
    },
    payments: payments.map((p) => ({
      amount: amount(p.amount, d),
      status: p.status,
      transaction_hash: p.source === "simulated" ? null : p.transaction_hash,
      explorer_url: explorerTx(p.transaction_hash, p.source === "simulated", p.network_id),
      simulated: p.source === "simulated",
      paid_at: p.block_timestamp
    }))
  };
}

import { appEnv, loadNearNetworks, paymentAssetById, paymentNetworkById } from "@zetra/config";
import { withSystem, type Client } from "@zetra/database";
import { extractFinalFtTransfers, NearRpcClient, sendFt, payoutSignerFor } from "@zetra/blockchain";
import { newId, toBaseUnits, type Environment } from "@zetra/schemas";
import { accountSafely } from "./accounting/posting-rules";
import { booksSettings, nativeAccount, systemAccount, valueInReporting, type BooksSettings, walletAccount } from "./accounting/chart";
import { allocateRefundDebit } from "./accounting/refund-split";
import { emitBusinessEvent } from "./accounting/business-events";
import { isoDate, postEntry, type LineInput } from "./accounting/ledger";
import { money } from "./accounting/reports";
import { audit, EngineError, log, SYSTEM, type Actor } from "./context";
import { validateWalletSignedPayoutActions } from "./payout-validation";

type Row = Record<string, any>;

const ACTIVE_REFUND_STATUSES = ["pending_approval", "approved", "submitting", "submitted"];

function assetFor(networkId: string, symbol: string) {
  const network = paymentNetworkById(networkId);
  const asset = network?.assets.find((candidate) => candidate.symbol === symbol.toUpperCase());
  if (!asset) throw new EngineError("asset_unknown", `The ${symbol} asset is not enabled on ${networkId}.`, 422);
  return asset;
}

export async function createPayoutRequest(client: Client, organizationId: string, environment: Environment, input: {
  kind: "payment" | "refund" | "vendor";
  walletId: string;
  recipient: string;
  amount: string;
  asset: string;
  memo?: string;
  paymentId?: string;
  invoiceId?: string;
  vendorId?: string;
  billId?: string;
  idempotencyKey: string;
}, actor: Actor): Promise<Row> {
  const duplicate = (await client.query("SELECT * FROM payout_requests WHERE organization_id = $1 AND environment = $2 AND idempotency_key = $3", [organizationId, environment, input.idempotencyKey])).rows[0] as Row | undefined;
  if (duplicate) return duplicate;
  const wallet = (await client.query("SELECT * FROM wallets WHERE id = $1 AND organization_id = $2 AND environment = $3 AND archived_at IS NULL", [input.walletId, organizationId, environment])).rows[0] as Row | undefined;
  if (!wallet) throw new EngineError("wallet_not_found", "Choose an active wallet in this workspace.", 404);
  if (!wallet.network_id.startsWith("near:")) throw new EngineError("near_only", "Outgoing transfers currently support NEAR only.", 422);
  const asset = assetFor(wallet.network_id, input.asset);
  const assetRow = (await client.query("SELECT id FROM assets WHERE id = $1 AND network_id = $2 AND enabled = true", [asset.id, wallet.network_id])).rows[0];
  if (!assetRow) throw new EngineError("asset_not_configured", "This wallet asset is not configured.", 422);
  const enabled = (await client.query("SELECT 1 FROM wallet_assets WHERE wallet_id = $1 AND asset_id = $2", [wallet.id, asset.id])).rows[0];
  if (!enabled) throw new EngineError("asset_not_enabled", "Enable this asset on the payout wallet first.", 422);
  const amount = toBaseUnits(input.amount, asset.decimals);
  if (amount <= 0n) throw new EngineError("amount_invalid", "Payout amount must be positive.", 422);
  const recipient = input.recipient.toLowerCase();
  if (recipient === wallet.address.toLowerCase()) throw new EngineError("recipient_invalid", "A payout recipient must differ from the sending wallet.", 422);
  let invoiceId = input.invoiceId ?? null;
  if (input.paymentId) {
    const p = (await client.query(`SELECT * FROM payments WHERE id = $1 AND organization_id = $2 AND environment = $3${input.kind === "refund" ? " FOR UPDATE" : ""}`, [input.paymentId, organizationId, environment])).rows[0] as Row | undefined;
    if (!p) throw new EngineError("payment_not_found", "No such payment.", 404);
    if (p.wallet_id !== wallet.id || p.asset_id !== asset.id) throw new EngineError("payout_mismatch", "The payout does not match the payment wallet and asset.", 422);
    if (input.kind === "refund") {
      if (p.source === "simulated" || !p.transaction_hash || !p.from_address || !["matched", "partial", "overpaid", "needs_review", "dismissed"].includes(p.status)) {
        throw new EngineError("payment_not_refundable", "Only a real, finalized NEAR receipt can be refunded.", 409);
      }
      if ((await client.query(
        "SELECT 1 FROM transaction_classifications WHERE organization_id = $1 AND environment = $2 AND payment_id = $3 AND reversed_at IS NULL LIMIT 1",
        [organizationId, environment, p.id]
      )).rows[0]) throw new EngineError("payment_classification_must_be_reversed", "Undo the payment's active accounting classification before refunding it, so the refund reverses the correct balance.", 409);
      if (recipient !== String(p.from_address).toLowerCase()) throw new EngineError("refund_recipient_mismatch", "A refund must return to the wallet that sent the original payment.", 422);
      if (input.invoiceId && input.invoiceId !== p.invoice_id) throw new EngineError("payout_mismatch", "A refund must remain linked to the original invoice.", 422);
      const alreadyRefunded = (await client.query(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM payout_requests
          WHERE payment_id = $1 AND kind = 'refund' AND status = ANY($2)`,
        [p.id, [...ACTIVE_REFUND_STATUSES, "confirmed"]]
      )).rows[0] as Row;
      if (amount + BigInt(alreadyRefunded.total ?? 0) > BigInt(p.amount)) throw new EngineError("refund_too_large", "Cumulative refunds cannot exceed the original payment.", 422);
      invoiceId = p.invoice_id ?? null;
    }
  }
  if (input.kind === "refund" && !input.paymentId) throw new EngineError("refund_payment_required", "Refunds must reference the payment they reverse.", 422);
  if (input.invoiceId) {
    const invoice = (await client.query("SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 AND environment = $3", [input.invoiceId, organizationId, environment])).rows[0];
    if (!invoice) throw new EngineError("invoice_not_found", "The payout invoice does not belong to this workspace.", 404);
  }
  if (input.vendorId) {
    const vendor = (await client.query("SELECT id FROM vendors WHERE id = $1 AND organization_id = $2 AND environment = $3", [input.vendorId, organizationId, environment])).rows[0];
    if (!vendor) throw new EngineError("vendor_not_found", "The payout vendor does not belong to this workspace.", 404);
  }
  let billId: string | null = null;
  let vendorId: string | null = input.vendorId ?? null;
  let memo = input.memo ?? null;
  if (input.kind === "vendor") {
    if (!input.vendorId || !input.billId) throw new EngineError("bill_required", "A vendor payout must be linked to an approved bill.", 422);
    const bill = (await client.query(
      "SELECT * FROM bills WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE",
      [input.billId, organizationId, environment]
    )).rows[0] as Row | undefined;
    if (!bill || bill.vendor_id !== input.vendorId) throw new EngineError("bill_vendor_mismatch", "Choose a bill belonging to this vendor and workspace.", 404);
    if (!["approved", "partially_paid"].includes(bill.status)) throw new EngineError("bill_not_payable", "Approve the bill before paying it.", 409);
    const address = (await client.query(
      "SELECT 1 FROM vendor_addresses WHERE organization_id = $1 AND environment = $2 AND vendor_id = $3 AND network_id = $4 AND lower(address) = $5",
      [organizationId, environment, input.vendorId, wallet.network_id, recipient]
    )).rows[0];
    if (!address) throw new EngineError("vendor_address_unverified", "The recipient must be a NEAR wallet saved on this vendor's record.", 422);
    const settings = await booksSettings(client, organizationId, environment);
    const { amount: reportingAmount } = valueInReporting(asset.id, amount, settings.reportingCurrency);
    const reserved = (await client.query(
      `SELECT COALESCE(SUM(amount), 0)::text AS amount FROM payout_requests
        WHERE bill_id = $1 AND kind = 'vendor' AND status = ANY($2)`,
      [bill.id, ["pending_approval", "approved", "submitting", "submitted"]]
    )).rows[0] as Row;
    const remaining = BigInt(bill.amount) - BigInt(bill.amount_paid) - BigInt(reserved.amount ?? 0);
    if (reportingAmount > remaining) throw new EngineError("payout_exceeds_bill", `This exceeds the ${money(remaining > 0n ? remaining : 0n)} still available on the bill, including other pending payouts.`, 422);
    billId = bill.id;
    vendorId = bill.vendor_id;
    memo = memo ?? `zetra:bill:${bill.id}`;
  } else if (input.billId) {
    throw new EngineError("bill_kind_mismatch", "Bills can only be paid with a vendor payout.", 422);
  }
  const id = newId(input.kind === "refund" ? "refund" : "outgoingTransfer");
  const inserted = await client.query(
    `INSERT INTO payout_requests (id, organization_id, environment, kind, wallet_id, network_id, asset_id, token_address, recipient, amount, memo, payment_id, invoice_id, vendor_id, bill_id, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (organization_id, environment, idempotency_key) DO NOTHING
     RETURNING *`,
    [id, organizationId, environment, input.kind, wallet.id, wallet.network_id, asset.id, asset.contractId, recipient, amount.toString(), memo, input.paymentId ?? null, invoiceId, vendorId, billId, input.idempotencyKey, actor.id ?? null]
  );
  const created = inserted.rows[0] as Row | undefined;
  if (!created) {
    // The initial lookup is only a fast path. Resolve a concurrent request atomically rather than
    // leaking a unique-constraint error (or creating a second transfer) to the caller.
    const raced = (await client.query(
      "SELECT * FROM payout_requests WHERE organization_id = $1 AND environment = $2 AND idempotency_key = $3",
      [organizationId, environment, input.idempotencyKey]
    )).rows[0] as Row | undefined;
    if (raced) return raced;
    throw new EngineError("payout_idempotency_conflict", "This payout request could not be saved safely. Retry with the same idempotency key.", 409);
  }
  await audit(client, actor, { organizationId, environment, action: "payout_requested", objectType: "payout", objectId: id, next: { kind: input.kind, wallet_id: wallet.id, recipient, amount: amount.toString(), asset_id: asset.id } });
  return created;
}

/** Read real NEAR balances and NEP-141 storage requirements before a business signs a vendor bill payment. */
export async function preflightVendorPayout(client: Client, organizationId: string, environment: Environment, input: {
  wallet_id: string;
  bill_id: string;
  vendor_id: string;
  recipient: string;
  amount: string;
}): Promise<Row> {
  const wallet = (await client.query("SELECT * FROM wallets WHERE id = $1 AND organization_id = $2 AND environment = $3 AND archived_at IS NULL", [input.wallet_id, organizationId, environment])).rows[0] as Row | undefined;
  if (!wallet || !String(wallet.network_id).startsWith("near:")) throw new EngineError("wallet_not_found", "Choose an active NEAR wallet in this workspace.", 404);
  const bill = (await client.query("SELECT * FROM bills WHERE id = $1 AND organization_id = $2 AND environment = $3", [input.bill_id, organizationId, environment])).rows[0] as Row | undefined;
  if (!bill || bill.vendor_id !== input.vendor_id) throw new EngineError("bill_vendor_mismatch", "Choose a bill belonging to this vendor and workspace.", 404);
  if (!["approved", "partially_paid"].includes(bill.status)) throw new EngineError("bill_not_payable", "Approve the bill before paying it.", 409);
  const recipient = input.recipient.trim().toLowerCase();
  const address = (await client.query("SELECT 1 FROM vendor_addresses WHERE organization_id = $1 AND environment = $2 AND vendor_id = $3 AND network_id = $4 AND lower(address) = $5", [organizationId, environment, input.vendor_id, wallet.network_id, recipient])).rows[0];
  if (!address) throw new EngineError("vendor_address_unverified", "Choose a NEAR address saved on this vendor's record.", 422);
  const asset = assetFor(wallet.network_id, "USDC");
  const enabled = (await client.query("SELECT 1 FROM wallet_assets WHERE wallet_id = $1 AND asset_id = $2", [wallet.id, asset.id])).rows[0];
  if (!enabled) throw new EngineError("asset_not_enabled", "Enable USDC on the sending business wallet first.", 422);
  const { amount: amountBase } = valueInReporting(asset.id, toBaseUnits(input.amount, asset.decimals), (await booksSettings(client, organizationId, environment)).reportingCurrency);
  const reserved = (await client.query(
    `SELECT COALESCE(SUM(amount), 0)::text AS amount FROM payout_requests
      WHERE bill_id = $1 AND kind = 'vendor' AND status = ANY($2)`,
    [bill.id, ["pending_approval", "approved", "submitting", "submitted"]]
  )).rows[0] as Row;
  const remaining = BigInt(bill.amount) - BigInt(bill.amount_paid) - BigInt(reserved.amount ?? 0);
  if (amountBase > remaining) throw new EngineError("payout_exceeds_bill", `This exceeds the ${money(remaining > 0n ? remaining : 0n)} still available on the bill, including other pending payouts.`, 422);

  const network = loadNearNetworks().find((candidate) => candidate.id === wallet.network_id && candidate.enabled && candidate.environment === environment);
  if (!network) throw new EngineError("network_unavailable", "NEAR is not enabled for this workspace environment on this deployment.", 503);
  const rpc = new NearRpcClient(network);
  let bounds: { min: string; max: string };
  let senderStorage: { total: string; available: string } | null;
  let recipientStorage: { total: string; available: string } | null;
  let tokenBalance: string;
  let nativeBalance: bigint | null;
  try {
    [bounds, senderStorage, recipientStorage, tokenBalance, nativeBalance] = await Promise.all([
      rpc.viewFunction<{ min: string; max: string }>(asset.contractId, "storage_balance_bounds", {}),
      rpc.viewFunction<{ total: string; available: string } | null>(asset.contractId, "storage_balance_of", { account_id: wallet.address }),
      rpc.viewFunction<{ total: string; available: string } | null>(asset.contractId, "storage_balance_of", { account_id: recipient }),
      rpc.viewFunction<string>(asset.contractId, "ft_balance_of", { account_id: wallet.address }),
      rpc.getAccountBalance(wallet.address)
    ]);
  } catch {
    throw new EngineError("payout_preflight_unavailable", "Could not read the NEAR token and wallet balances. Retry before signing; no payout was created.", 503);
  }
  if (!bounds || !/^\d+$/.test(bounds.min) || !/^\d+$/.test(bounds.max) || !/^\d+$/.test(tokenBalance)) throw new EngineError("token_contract_unavailable", "The configured USDC contract returned invalid storage or balance data.", 503);
  const needsStorageDeposit = !recipientStorage;
  const storageDeposit = needsStorageDeposit ? BigInt(bounds.min) : 0n;
  const gasReserve = 10n ** 22n;
  const requiredNear = storageDeposit + gasReserve;
  const canPay = !!senderStorage && nativeBalance !== null && BigInt(tokenBalance) >= toBaseUnits(input.amount, asset.decimals) && nativeBalance >= requiredNear;
  return {
    network_id: wallet.network_id,
    network_name: network.id === "near:mainnet" ? "NEAR Mainnet" : "NEAR Testnet",
    token_contract: asset.contractId,
    sender_account_id: wallet.address,
    recipient_account_id: recipient,
    token_symbol: asset.symbol,
    amount_base_units: toBaseUnits(input.amount, asset.decimals).toString(),
    token_balance_base_units: tokenBalance,
    sender_token_registered: !!senderStorage,
    recipient_token_registered: !!recipientStorage,
    storage_deposit_yocto: storageDeposit.toString(),
    native_balance_yocto: nativeBalance?.toString() ?? null,
    required_near_yocto: requiredNear.toString(),
    gas_reserve_yocto: gasReserve.toString(),
    can_pay: canPay,
    reason: !senderStorage ? "The business wallet is not registered with this USDC contract." : nativeBalance === null ? "The business NEAR wallet account does not exist on this network." : BigInt(tokenBalance) < toBaseUnits(input.amount, asset.decimals) ? "The business wallet does not have enough USDC." : nativeBalance < requiredNear ? "The business wallet needs more NEAR for token registration and network gas." : null
  };
}

export async function createRefundRequest(client: Client, organizationId: string, environment: Environment, paymentId: string, input: { amount?: string; memo?: string; idempotencyKey: string }, actor: Actor): Promise<Row> {
  const duplicate = (await client.query("SELECT * FROM payout_requests WHERE organization_id = $1 AND environment = $2 AND idempotency_key = $3", [organizationId, environment, input.idempotencyKey])).rows[0] as Row | undefined;
  if (duplicate) return duplicate;
  const payment = (await client.query("SELECT * FROM payments WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [paymentId, organizationId, environment])).rows[0] as Row | undefined;
  if (!payment) throw new EngineError("payment_not_found", "No such payment.", 404);
  // Serialize same-payment refund requests before checking the cumulative refund limit. A retry
  // racing with the original request must return that request even if its amount is now reserved.
  const afterLock = (await client.query("SELECT * FROM payout_requests WHERE organization_id = $1 AND environment = $2 AND idempotency_key = $3", [organizationId, environment, input.idempotencyKey])).rows[0] as Row | undefined;
  if (afterLock) return afterLock;
  if (payment.source === "simulated" || !payment.transaction_hash || !payment.from_address) throw new EngineError("payment_not_refundable", "Simulated or incomplete payment evidence cannot be refunded on-chain.", 409);
  if (!["matched", "partial", "overpaid", "needs_review", "dismissed"].includes(payment.status)) throw new EngineError("payment_not_refundable", "Only a finalized payment can be refunded.", 409);
  const asset = payment.asset_id ? paymentAssetById(payment.asset_id)?.asset : undefined;
  if (!asset) throw new EngineError("asset_unknown", "This payment has no supported accounting asset.", 422);
  const amount = input.amount ?? (await import("@zetra/schemas")).fromBaseUnits(BigInt(payment.amount), asset.decimals);
  const requested = toBaseUnits(amount, asset.decimals);
  const alreadyRefunded = (await client.query(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM payout_requests
      WHERE payment_id = $1 AND kind = 'refund' AND status = ANY($2)`,
    [payment.id, [...ACTIVE_REFUND_STATUSES, "confirmed"]]
  )).rows[0] as Row;
  if (requested + BigInt(alreadyRefunded.total ?? 0) > BigInt(payment.amount)) throw new EngineError("refund_too_large", "Cumulative refunds cannot exceed the original payment.", 422);
  return createPayoutRequest(client, organizationId, environment, {
    kind: "refund",
    walletId: payment.wallet_id,
    recipient: payment.from_address,
    amount,
    asset: asset.symbol,
    memo: input.memo ?? `Refund for ${payment.transaction_hash}`,
    paymentId: payment.id,
    invoiceId: payment.invoice_id ?? undefined,
    idempotencyKey: input.idempotencyKey
  }, actor);
}

export async function approvePayout(client: Client, organizationId: string, environment: Environment, payoutId: string, actor: Actor): Promise<Row> {
  const before = (await client.query("SELECT * FROM payout_requests WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [payoutId, organizationId, environment])).rows[0] as Row | undefined;
  if (!before) throw new EngineError("not_found", "No such payout.", 404);
  if (before.kind === "refund") throw new EngineError("refund_wallet_signature_required", "Refunds are approved by signing the exact return transfer from the business wallet. They cannot be submitted through the automated payout worker.", 409);
  if (!["pending_approval", "failed"].includes(before.status)) throw new EngineError("payout_not_approvable", `This payout is ${before.status}.`, 409);
  await client.query("UPDATE payout_requests SET status = 'approved', approved_by = $2, approved_at = now(), error = NULL, updated_at = now() WHERE id = $1", [payoutId, actor.id ?? null]);
  await audit(client, actor, { organizationId, environment, action: "payout_approved", objectType: "payout", objectId: payoutId, previous: { status: before.status }, next: { status: "approved" } });
  return (await client.query("SELECT * FROM payout_requests WHERE id = $1", [payoutId])).rows[0] as Row;
}

/** Persist the hash immediately after a business wallet returns it, so finality checks can be retried safely. */
export async function submitWalletSignedPayout(client: Client, organizationId: string, environment: Environment, payoutId: string, transactionHash: string, actor: Actor): Promise<Row> {
  const payout = (await client.query("SELECT * FROM payout_requests WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [payoutId, organizationId, environment])).rows[0] as Row | undefined;
  if (!payout) throw new EngineError("not_found", "No such payout.", 404);
  if (payout.kind !== "vendor" && payout.kind !== "refund") throw new EngineError("wallet_submission_not_supported", "This payout does not use the wallet-signed NEAR transfer flow.", 409);
  if (payout.status === "submitted" && payout.tx_hash === transactionHash) return payout;
  const expectedStatus = payout.kind === "refund" ? "pending_approval" : "approved";
  if (payout.status !== expectedStatus) throw new EngineError("payout_not_submittable", `This ${payout.kind} is ${payout.status} and cannot accept a transaction hash.`, 409);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [transactionHash]);
  const duplicate = (await client.query("SELECT id FROM payout_requests WHERE tx_hash = $1 AND id <> $2 LIMIT 1", [transactionHash, payout.id])).rows[0];
  if (duplicate) throw new EngineError("payout_transaction_used", "This transaction has already been linked to another payout.", 409);
  await client.query(
    `UPDATE payout_requests SET status = 'submitted', tx_hash = $2, submitted_at = now(), updated_at = now(), error = NULL,
       approved_by = CASE WHEN kind = 'refund' THEN $3 ELSE approved_by END,
       approved_at = CASE WHEN kind = 'refund' THEN now() ELSE approved_at END
      WHERE id = $1`,
    [payout.id, transactionHash, actor.id ?? null]
  );
  await audit(client, actor, { organizationId, environment, action: payout.kind === "refund" ? "refund_wallet_transaction_submitted" : "vendor_payout_submitted", objectType: "payout", objectId: payout.id, previous: { status: payout.status }, next: { status: "submitted", tx_hash: transactionHash, verification: "pending_finality" } });
  return (await client.query("SELECT * FROM payout_requests WHERE id = $1", [payout.id])).rows[0] as Row;
}

/**
 * Confirm a refund signed by the business in its own NEAR wallet. Zetra verifies finalized
 * token-contract event evidence before recording the payout or posting its accounting entry.
 */
export async function confirmWalletSignedRefund(client: Client, organizationId: string, environment: Environment, payoutId: string, transactionHash: string, actor: Actor): Promise<Row> {
  return confirmWalletSignedTransfer(client, organizationId, environment, payoutId, transactionHash, actor, "refund");
}

export async function confirmWalletSignedVendorPayout(client: Client, organizationId: string, environment: Environment, payoutId: string, transactionHash: string, actor: Actor): Promise<Row> {
  return confirmWalletSignedTransfer(client, organizationId, environment, payoutId, transactionHash, actor, "vendor");
}

async function confirmWalletSignedTransfer(client: Client, organizationId: string, environment: Environment, payoutId: string, transactionHash: string, actor: Actor, expectedKind: "refund" | "vendor"): Promise<Row> {
  const payout = (await client.query(
    `SELECT p.*, w.address AS wallet_address FROM payout_requests p JOIN wallets w ON w.id = p.wallet_id
      WHERE p.id = $1 AND p.organization_id = $2 AND p.environment = $3 FOR UPDATE OF p`,
    [payoutId, organizationId, environment]
  )).rows[0] as Row | undefined;
  if (!payout) throw new EngineError("not_found", "No such payout request.", 404);
  if (payout.kind !== expectedKind) throw new EngineError("payout_kind_mismatch", `This request is not a ${expectedKind} payout.`, 409);
  if (payout.status === "confirmed" && payout.tx_hash === transactionHash) return payout;
  if (expectedKind === "refund" && (payout.status !== "submitted" || payout.tx_hash !== transactionHash)) throw new EngineError("refund_not_submitted", "Record the signed refund transaction first. Zetra will not mark it refunded until NEAR finality and the exact transfer are verified.", 409);
  if (expectedKind === "vendor" && (payout.status !== "submitted" || payout.tx_hash !== transactionHash)) throw new EngineError("vendor_payout_not_submitted", "Record the wallet transaction hash first. This bill will not be marked paid until its finality is verified.", 409);

  const network = loadNearNetworks().find((candidate) => candidate.id === payout.network_id);
  if (!network?.enabled || network.environment !== environment) throw new EngineError("network_unavailable", "This payout's NEAR network is not enabled.", 503);
  const rpc = new NearRpcClient(network);
  let evidence: Record<string, unknown>;
  try {
    evidence = await rpc.getFinalTransactionStatus(transactionHash, String(payout.wallet_address));
  } catch {
    throw new EngineError("payout_evidence_unavailable", "Could not verify this transfer on NEAR yet. Retry finality verification; the bill has not been marked paid.", 503);
  }
  const transaction = evidence.transaction as Row | undefined;
  if (!transaction || transaction.hash !== transactionHash || String(transaction.signer_id).toLowerCase() !== String(payout.wallet_address).toLowerCase() || String(transaction.receiver_id).toLowerCase() !== String(payout.token_address).toLowerCase()) {
    throw new EngineError("payout_transaction_mismatch", "This finalized transaction was not sent by the selected business wallet to the configured token contract.", 422);
  }
  let storageDeposit = 0n;
  try {
    storageDeposit = validateWalletSignedPayoutActions(transaction, {
      recipient: String(payout.recipient),
      amount: String(payout.amount),
      memo: payout.memo == null ? null : String(payout.memo)
    }, expectedKind === "vendor");
  } catch (error) {
    throw new EngineError("payout_actions_invalid", error instanceof Error ? error.message : "The transaction contains actions outside the requested transfer.", 422);
  }
  const transfers = extractFinalFtTransfers(evidence, new Set([String(payout.token_address)]));
  const matchedTransfers = transfers.filter((item) => item.senderAccountId.toLowerCase() === String(payout.wallet_address).toLowerCase()
    && item.receiverAccountId.toLowerCase() === String(payout.recipient).toLowerCase()
    && item.amount === BigInt(payout.amount)
    && (payout.memo == null || item.memo === payout.memo));
  if (matchedTransfers.length !== 1 || transfers.length !== 1) throw new EngineError("payout_transfer_not_found", "The finalized transaction must contain exactly one USDC transfer matching the requested recipient, amount and memo. No payout was recorded.", 422);
  const transfer = matchedTransfers[0]!;
  if (expectedKind === "vendor" && storageDeposit > 0n) await verifyStorageDepositMinimum(rpc, payout, storageDeposit);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [transactionHash]);
  const duplicate = (await client.query("SELECT id FROM payout_requests WHERE tx_hash = $1 AND id <> $2 LIMIT 1", [transactionHash, payout.id])).rows[0];
  if (duplicate) throw new EngineError("payout_transaction_used", "This transaction has already been recorded against another payout.", 409);

  const outcomeValues = [evidence.transaction_outcome, ...(Array.isArray(evidence.receipts_outcome) ? evidence.receipts_outcome : [])]
    .map((item) => (item && typeof item === "object" && "outcome" in item ? (item as Row).outcome : null))
    .filter((item): item is Row => !!item && typeof item === "object");
  const sumOutcome = (field: "gas_burnt" | "tokens_burnt") => {
    const values = outcomeValues.map((item) => item[field]).filter((value) => (typeof value === "string" && /^\d+$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value))).map(BigInt);
    return values.length ? values.reduce((total, value) => total + value, 0n) : null;
  };
  const gasBurnt = sumOutcome("gas_burnt");
  const fee = sumOutcome("tokens_burnt");
  const attempt = (await client.query(
    `INSERT INTO payout_attempts (id, organization_id, environment, payout_id, attempt_number, status, tx_hash, block_hash, gas_burnt, tokens_burnt, fee_yoctonear, storage_deposit_yocto, raw)
     VALUES ($1,$2,$3,$4,1,'confirmed',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [newId("payoutAttempt"), organizationId, environment, payout.id, transactionHash, transfer.blockHash, gasBurnt?.toString() ?? null, fee?.toString() ?? null, fee?.toString() ?? null, storageDeposit.toString(), JSON.stringify(evidence)]
  )).rows[0] as Row;
  await client.query(
    `UPDATE payout_requests SET status = 'confirmed', tx_hash = $2, block_hash = $3,
       confirmed_at = now(), updated_at = now(), error = NULL
      WHERE id = $1`,
    [payout.id, transactionHash, transfer.blockHash]
  );
  if (fee !== null) await gasAccounting(client, payout, attempt, fee);
  if (storageDeposit > 0n) await tokenStorageAccounting(client, payout, attempt, storageDeposit);
  await payoutAccounting(client, payout, attempt);
  await audit(client, actor, { organizationId, environment, action: expectedKind === "refund" ? "refund_confirmed" : "vendor_payout_confirmed", objectType: "payout", objectId: payout.id, previous: { status: payout.status }, next: { status: "confirmed", tx_hash: transactionHash, block_hash: transfer.blockHash } });
  return (await client.query("SELECT * FROM payout_requests WHERE id = $1", [payout.id])).rows[0] as Row;
}

async function verifyStorageDepositMinimum(rpc: NearRpcClient, payout: Row, storageDeposit: bigint): Promise<void> {
  const asset = paymentAssetById(payout.asset_id)?.asset;
  const bounds = asset ? await rpc.viewFunction<{ min: string; max: string }>(asset.contractId, "storage_balance_bounds", {}) : null;
  if (!bounds || !/^\d+$/.test(bounds.min) || storageDeposit !== BigInt(bounds.min)) throw new EngineError("payout_storage_deposit_mismatch", "The recipient storage deposit does not match the token contract's current minimum.", 422);
}

export async function cancelPayout(client: Client, organizationId: string, environment: Environment, payoutId: string, reason: string | undefined, actor: Actor): Promise<Row> {
  const before = (await client.query("SELECT * FROM payout_requests WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [payoutId, organizationId, environment])).rows[0] as Row | undefined;
  if (!before) throw new EngineError("not_found", "No such payout.", 404);
  if (!["pending_approval", "approved", "failed"].includes(before.status)) throw new EngineError("payout_not_cancellable", `A ${before.status} payout cannot be cancelled.`, 409);
  await client.query("UPDATE payout_requests SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), error = $3, updated_at = now() WHERE id = $1", [payoutId, actor.id ?? null, reason ?? null]);
  await audit(client, actor, { organizationId, environment, action: "payout_cancelled", objectType: "payout", objectId: payoutId, previous: { status: before.status }, next: { status: "cancelled", reason: reason ?? null } });
  return (await client.query("SELECT * FROM payout_requests WHERE id = $1", [payoutId])).rows[0] as Row;
}

async function claimPayout(): Promise<Row | undefined> {
  return withSystem(async (client) => {
    // Never automatically requeue an interrupted submission: the NEAR transaction may have
    // reached finality even if the worker crashed before persisting its hash, and a second
    // submission could pay the recipient twice. An operator must inspect chain evidence and
    // explicitly resolve an uncertain request before retrying it.
    const row = (await client.query("SELECT * FROM payout_requests WHERE status = 'approved' AND kind = 'payment' ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0] as Row | undefined;
    if (!row) return undefined;
    await client.query("UPDATE payout_requests SET status = 'submitting', updated_at = now() WHERE id = $1", [row.id]);
    return { ...row, status: "submitting" };
  });
}

function parseRate(raw: string): { numerator: bigint; denominator: bigint } {
  const [whole, fraction = ""] = raw.split(".");
  const digits = `${whole}${fraction}`;
  return { numerator: BigInt(digits), denominator: 10n ** BigInt(fraction.length) };
}

async function gasAccounting(client: Client, payout: Row, attempt: Row, fee: bigint): Promise<void> {
  const date = new Date(attempt.created_at);
  const rateRow = (await client.query("SELECT rate::text AS rate, source FROM fx_rates WHERE (organization_id = $1 OR organization_id IS NULL) AND base = 'NEAR' AND quote = 'USD' AND rate_date <= $2::date ORDER BY (organization_id IS NULL), rate_date DESC LIMIT 1", [payout.organization_id, date])).rows[0] as Row | undefined;
  const fallback = appEnv().NEAR_FEE_USD_RATE;
  const rate = rateRow?.rate ?? fallback;
  let reportingMicros: bigint | null = null;
  let rateSource: string | null = null;
  if (rate) {
    const parsed = parseRate(String(rate));
    const numerator = fee * parsed.numerator * 1_000_000n;
    const denominator = 10n ** 24n * parsed.denominator;
    reportingMicros = (numerator + denominator / 2n) / denominator;
    rateSource = rateRow ? `fx:${rateRow.source ?? "configured"}` : "env:NEAR_FEE_USD_RATE";
  }
  await client.query(
    `INSERT INTO network_fee_records (id, organization_id, environment, payout_attempt_id, wallet_id, network_id, fee_yoctonear, fee_reporting_micros, rate_source, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (payout_attempt_id) DO NOTHING`,
    [newId("networkFee"), payout.organization_id, payout.environment, attempt.id, payout.wallet_id, payout.network_id, fee.toString(), reportingMicros?.toString() ?? null, rateSource, reportingMicros === null ? "unvalued" : "valued"]
  );
  if (reportingMicros === null || reportingMicros === 0n) {
    if (reportingMicros === null) {
      await client.query(
        `INSERT INTO accounting_issues (id, organization_id, environment, source_key, source_type, source_id, message)
         VALUES ($1,$2,$3,$4,'network_fee',$5,'NEAR fee recorded in yoctoNEAR but no NEAR/USD valuation was available.')
         ON CONFLICT (organization_id,environment,source_key) DO UPDATE SET resolved_at = NULL, updated_at = now()`,
        [newId("accountingIssue"), payout.organization_id, payout.environment, `network-fee:${attempt.id}`, attempt.id]
      );
    }
    return;
  }
  await accountSafely(client, { organizationId: payout.organization_id, environment: payout.environment, sourceKey: `network-fee:${attempt.id}`, sourceType: "network_fee", sourceId: attempt.id }, async (settings) => {
    const expense = await systemAccount(client, payout.organization_id, payout.environment, "network_fees");
    const native = await nativeAccount(client, payout.organization_id, payout.environment, payout.wallet_id, "NEAR");
    await postEntry(client, {
      organizationId: payout.organization_id,
      environment: payout.environment,
      date,
      description: `NEAR gas fee for ${payout.id}`,
      memo: "Final network fee from the NEAR execution outcome.",
      sourceType: "network_fee",
      sourceId: attempt.id,
      sourceKey: `network-fee:${attempt.id}`,
      actor: SYSTEM,
      lines: [
        { accountId: expense.id, debit: reportingMicros, payoutAttemptId: attempt.id, assetAmount: fee, rateSource: rateSource ?? settings.reportingCurrency },
        { accountId: native.id, credit: reportingMicros, payoutAttemptId: attempt.id, assetAmount: fee, rateSource: rateSource ?? settings.reportingCurrency }
      ]
    });
  });
}

/** The vendor receives the token account's storage collateral, so record it as a separate setup expense. */
async function tokenStorageAccounting(client: Client, payout: Row, attempt: Row, deposit: bigint): Promise<void> {
  const date = new Date(attempt.created_at);
  const rateRow = (await client.query("SELECT rate::text AS rate, source FROM fx_rates WHERE (organization_id = $1 OR organization_id IS NULL) AND base = 'NEAR' AND quote = 'USD' AND rate_date <= $2::date ORDER BY (organization_id IS NULL), rate_date DESC LIMIT 1", [payout.organization_id, date])).rows[0] as Row | undefined;
  const rate = rateRow?.rate ?? appEnv().NEAR_FEE_USD_RATE;
  if (!rate) {
    await client.query(
      `INSERT INTO accounting_issues (id, organization_id, environment, source_key, source_type, source_id, message)
       VALUES ($1,$2,$3,$4,'token_storage_deposit',$5,'NEAR token-account storage deposit is recorded in yoctoNEAR but has no NEAR/USD valuation.')
       ON CONFLICT (organization_id,environment,source_key) DO UPDATE SET resolved_at = NULL, updated_at = now()`,
      [newId("accountingIssue"), payout.organization_id, payout.environment, `token-storage:${attempt.id}`, attempt.id]
    );
    return;
  }
  const parsed = parseRate(String(rate));
  const numerator = deposit * parsed.numerator * 1_000_000n;
  const denominator = 10n ** 24n * parsed.denominator;
  const reportingMicros = (numerator + denominator / 2n) / denominator;
  if (reportingMicros <= 0n) return;
  const rateSource = rateRow ? `fx:${rateRow.source ?? "configured"}` : "env:NEAR_FEE_USD_RATE";
  await accountSafely(client, { organizationId: payout.organization_id, environment: payout.environment, sourceKey: `token-storage:${attempt.id}`, sourceType: "token_storage_deposit", sourceId: attempt.id }, async () => {
    const expense = await systemAccount(client, payout.organization_id, payout.environment, "token_storage_fees");
    const native = await nativeAccount(client, payout.organization_id, payout.environment, payout.wallet_id, "NEAR");
    await postEntry(client, {
      organizationId: payout.organization_id,
      environment: payout.environment,
      date,
      description: `USDC recipient account setup for ${payout.id}`,
      memo: "NEP-141 storage deposit attached to the finalized vendor payout.",
      sourceType: "token_storage_deposit",
      sourceId: attempt.id,
      sourceKey: `token-storage:${attempt.id}`,
      actor: SYSTEM,
      lines: [
        { accountId: expense.id, debit: reportingMicros, payoutAttemptId: attempt.id, assetAmount: deposit, rateSource },
        { accountId: native.id, credit: reportingMicros, payoutAttemptId: attempt.id, assetAmount: deposit, rateSource }
      ]
    });
  });
}

async function payoutAccounting(client: Client, payout: Row, attempt: Row): Promise<void> {
  if (payout.kind === "vendor") {
    if (!payout.bill_id || !payout.vendor_id) throw new EngineError("bill_required", "This vendor payout isn't linked to a payable.", 409);
    await accountSafely(client, { organizationId: payout.organization_id, environment: payout.environment, sourceKey: `vendor-payment:${payout.id}`, sourceType: "bill_payment", sourceId: payout.id }, async (settings: BooksSettings) => {
      const bill = (await client.query("SELECT * FROM bills WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [payout.bill_id, payout.organization_id, payout.environment])).rows[0] as Row | undefined;
      if (!bill || bill.vendor_id !== payout.vendor_id) throw new EngineError("bill_vendor_mismatch", "This payout no longer matches its vendor bill.", 409);
      if (!["approved", "partially_paid"].includes(bill.status)) throw new EngineError("bill_not_payable", `This bill is ${bill.status} and cannot be paid.`, 409);
      const asset = paymentAssetById(payout.asset_id)?.asset;
      if (!asset) throw new EngineError("asset_unknown", "This vendor payout asset has no accounting valuation.", 422);
      const { amount, rateSource } = valueInReporting(payout.asset_id, BigInt(payout.amount), settings.reportingCurrency);
      const remaining = BigInt(bill.amount) - BigInt(bill.amount_paid);
      if (amount > remaining) throw new EngineError("payout_exceeds_bill", "The finalized transfer exceeds the bill's remaining payable amount.", 409);
      const vendor = (await client.query("SELECT name FROM vendors WHERE id = $1 AND organization_id = $2 AND environment = $3", [payout.vendor_id, payout.organization_id, payout.environment])).rows[0] as Row | undefined;
      if (!vendor) throw new EngineError("vendor_not_found", "The vendor for this bill is no longer available.", 404);
      const ap = await systemAccount(client, payout.organization_id, payout.environment, "accounts_payable");
      const wallet = await walletAccount(client, payout.organization_id, payout.environment, payout.wallet_id, payout.asset_id);
      const paymentId = newId("billPayment");
      const paidOn = isoDate(new Date(attempt.created_at));
      await client.query(
        `INSERT INTO bill_payments (id, organization_id, environment, bill_id, amount, method, paid_from_account_id, paid_on, reference, memo, actor_type, actor_id, actor_label)
         VALUES ($1,$2,$3,$4,$5,'onchain',$6,$7,$8,$9,'user',$10,$11)`,
        [paymentId, payout.organization_id, payout.environment, bill.id, amount.toString(), wallet.id, paidOn, payout.tx_hash, payout.memo, payout.requested_by, "NEAR wallet"]
      );
      const paid = BigInt(bill.amount_paid) + amount;
      await client.query("UPDATE bills SET amount_paid = $2, status = $3, updated_at = now() WHERE id = $1", [bill.id, paid.toString(), paid >= BigInt(bill.amount) ? "paid" : "partially_paid"]);
      const refs: Partial<LineInput> = { payoutAttemptId: attempt.id, assetId: payout.asset_id, assetAmount: BigInt(payout.amount), rateSource };
      const { entry } = await postEntry(client, {
        organizationId: payout.organization_id,
        environment: payout.environment,
        date: paidOn,
        description: `Paid ${vendor.name}: bill ${bill.number}`,
        memo: payout.memo,
        sourceType: "bill_payment",
        sourceId: paymentId,
        sourceKey: `bill-payment:${paymentId}`,
        actor: SYSTEM,
        lines: [
          { ...refs, accountId: ap.id, debit: amount, vendorId: vendor.id, billId: bill.id, memo: `Settles bill ${bill.number}` },
          { ...refs, accountId: wallet.id, credit: amount, vendorId: vendor.id, billId: bill.id, memo: `NEAR transaction ${payout.tx_hash}` }
        ]
      });
      await emitBusinessEvent(client, { organizationId: payout.organization_id, environment: payout.environment, type: "PAYABLE_SETTLED", dedupeKey: `payable-settled:${paymentId}`, amount, vendorId: vendor.id, journalEntryId: entry.id, data: { bill: { id: bill.id, number: bill.number, title: bill.title, remaining: money(BigInt(bill.amount) - paid) }, vendor: { id: vendor.id, name: vendor.name }, payment: { id: paymentId, amount: money(amount), method: "onchain", transaction_hash: payout.tx_hash } } });
    });
    return;
  }
  if (payout.kind !== "refund") return;
  await accountSafely(client, { organizationId: payout.organization_id, environment: payout.environment, sourceKey: `refund:${payout.id}`, sourceType: "refund", sourceId: payout.id }, async (settings: BooksSettings) => {
    const asset = paymentAssetById(payout.asset_id)?.asset;
    if (!asset) throw new EngineError("asset_unknown", "Refund asset has no valuation.", 422);
    const { amount, rateSource } = valueInReporting(payout.asset_id, BigInt(payout.amount), settings.reportingCurrency);
    const wallet = await walletAccount(client, payout.organization_id, payout.environment, payout.wallet_id, payout.asset_id);
    if (!payout.payment_id) throw new EngineError("refund_payment_required", "This refund is not linked to an original payment.", 409);
    const suspense = await systemAccount(client, payout.organization_id, payout.environment, "payments_to_identify");
    const customerCredits = await systemAccount(client, payout.organization_id, payout.environment, "customer_credits");
    const sales = await systemAccount(client, payout.organization_id, payout.environment, "sales");
    const paymentLinkedBalance = async (accountId: string): Promise<bigint> => {
      const row = (await client.query(
        `SELECT COALESCE(SUM(CASE WHEN credit > 0 THEN COALESCE(asset_amount, 0) ELSE -COALESCE(asset_amount, 0) END), 0)::text AS balance
           FROM journal_lines
          WHERE organization_id = $1 AND environment = $2 AND payment_id = $3 AND account_id = $4 AND asset_id = $5`,
        [payout.organization_id, payout.environment, payout.payment_id, accountId, payout.asset_id]
      )).rows[0] as Row;
      return BigInt(row.balance ?? "0");
    };
    const sources = [
      { accountId: suspense.id, availableBaseUnits: await paymentLinkedBalance(suspense.id) },
      { accountId: customerCredits.id, availableBaseUnits: await paymentLinkedBalance(customerCredits.id) }
    ];
    const debits = allocateRefundDebit(BigInt(payout.amount), sources, sales.id);
    const valued = debits.map((line) => ({ ...line, debit: valueInReporting(payout.asset_id, line.assetAmount, settings.reportingCurrency).amount }));
    const valuedTotal = valued.reduce((sum, line) => sum + line.debit, 0n);
    const roundingDelta = amount - valuedTotal;
    if (roundingDelta !== 0n) {
      const adjustment = valued.reduce((best, current, index, all) => current.debit > all[best]!.debit ? index : best, 0);
      valued[adjustment]!.debit += roundingDelta;
    }
    const refs: Partial<LineInput> = { paymentId: payout.payment_id, invoiceId: payout.invoice_id ?? null, payoutAttemptId: attempt.id, assetId: payout.asset_id, rateSource };
    await postEntry(client, {
      organizationId: payout.organization_id,
      environment: payout.environment,
      date: new Date(attempt.created_at),
      description: `Refund ${payout.id}`,
      memo: "Confirmed outgoing NEAR refund.",
      sourceType: "refund",
      sourceId: payout.id,
      sourceKey: `refund:${payout.id}`,
      actor: SYSTEM,
      lines: [
        ...valued.map((line) => ({ ...refs, accountId: line.accountId, debit: line.debit, assetAmount: line.assetAmount, memo: line.accountId === sales.id ? "Customer refund · sales return" : "Customer refund · reverses the payment's credited balance" })),
        { ...refs, accountId: wallet.id, credit: amount, assetAmount: BigInt(payout.amount), memo: "NEAR asset sent" }
      ]
    });
  });
}

async function processOne(payout: Row): Promise<void> {
  const signer = payoutSignerFor(payout.network_id);
  if (!signer) {
    await withSystem(async (client) => {
      await client.query("UPDATE payout_requests SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = 'submitting'", [payout.id, "No payout signer is configured for this NEAR network."]);
    });
    return;
  }
  try {
    const wallet = (await withSystem((client) => client.query("SELECT address FROM wallets WHERE id = $1", [payout.wallet_id]))).rows[0] as Row | undefined;
    if (!wallet || wallet.address.toLowerCase() !== signer.signerId.toLowerCase()) throw new Error("The configured NEAR payout signer does not match the payout wallet.");
    const transfer = await sendFt({ networkId: payout.network_id, signerId: signer.signerId, privateKey: signer.privateKey, tokenContract: payout.token_address, receiverId: payout.recipient, amount: BigInt(payout.amount), memo: payout.memo ?? undefined });
    await withSystem(async (client) => {
      const attempt = (await client.query("INSERT INTO payout_attempts (id, organization_id, environment, payout_id, attempt_number, status, tx_hash, block_hash, gas_burnt, tokens_burnt, fee_yoctonear, raw) SELECT $1,$2,$3,$4,COALESCE((SELECT max(attempt_number)+1 FROM payout_attempts WHERE payout_id=$4),1),'confirmed',$5,$6,$7,$8,$9,$10 RETURNING *", [newId("payoutAttempt"), payout.organization_id, payout.environment, payout.id, transfer.txHash, transfer.blockHash, transfer.gasBurnt?.toString() ?? null, transfer.tokensBurnt?.toString() ?? null, transfer.feeYoctonear?.toString() ?? null, JSON.stringify(transfer.raw)])).rows[0] as Row;
      await client.query("UPDATE payout_requests SET status = 'confirmed', tx_hash = $2, block_hash = $3, submitted_at = COALESCE(submitted_at, now()), confirmed_at = now(), updated_at = now(), error = NULL WHERE id = $1", [payout.id, transfer.txHash, transfer.blockHash]);
      if (transfer.feeYoctonear !== null) await gasAccounting(client, payout, attempt, transfer.feeYoctonear);
      await payoutAccounting(client, payout, attempt);
    });
    log().info("near_payout_confirmed", { payoutId: payout.id, txHash: transfer.txHash });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await withSystem(async (client) => {
      await client.query("INSERT INTO payout_attempts (id, organization_id, environment, payout_id, attempt_number, status, error, raw) SELECT $1,$2,$3,$4,COALESCE((SELECT max(attempt_number)+1 FROM payout_attempts WHERE payout_id=$4),1),'failed',$5,'{}' ON CONFLICT (payout_id, attempt_number) DO NOTHING", [newId("payoutAttempt"), payout.organization_id, payout.environment, payout.id, detail.slice(0, 1000)]);
      await client.query("UPDATE payout_requests SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = 'submitting'", [payout.id, detail.slice(0, 1000)]);
    });
    log().error("near_payout_failed", { payoutId: payout.id, error: detail });
  }
}

/** Process at most one approved payout per tick; safe to run from multiple workers. */
export async function processDuePayouts(): Promise<{ processed: number }> {
  const payout = await claimPayout();
  if (!payout) return { processed: 0 };
  await processOne(payout);
  return { processed: 1 };
}

export function serializePayout(row: Row) {
  return {
    id: row.id,
    object: "payout",
    kind: row.kind,
    status: row.status,
    wallet_id: row.wallet_id,
    network_id: row.network_id,
    asset_id: row.asset_id,
    token_address: row.token_address,
    recipient: row.recipient,
    amount_base_units: String(row.amount),
    memo: row.memo ?? null,
    payment_id: row.payment_id ?? null,
    invoice_id: row.invoice_id ?? null,
    vendor_id: row.vendor_id ?? null,
    bill_id: row.bill_id ?? null,
    tx_hash: row.tx_hash ?? null,
    block_hash: row.block_hash ?? null,
    error: row.error ?? null,
    requested_at: row.requested_at,
    approved_at: row.approved_at,
    confirmed_at: row.confirmed_at,
    updated_at: row.updated_at
  };
}

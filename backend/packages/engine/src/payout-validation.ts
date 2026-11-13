type NearAction = Record<string, unknown>;
type PayoutExpectation = { recipient: string; amount: string; memo: string | null };

function callArgs(action: NearAction): Record<string, unknown> {
  const raw = action.args;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return parsed as Record<string, unknown>;
    } catch {
      throw new Error("The transaction contains invalid NEAR function arguments.");
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The transaction contains invalid NEAR function arguments.");
  return raw as Record<string, unknown>;
}

/** Validate the whole signer action list before accepting an outgoing NEP-141 transfer. */
export function validateWalletSignedPayoutActions(
  transaction: Record<string, unknown>,
  expected: PayoutExpectation,
  allowRecipientStorageDeposit: boolean
): bigint {
  const actions = transaction.actions;
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > (allowRecipientStorageDeposit ? 2 : 1)) {
    throw new Error(allowRecipientStorageDeposit
      ? "The transaction must contain exactly the requested USDC transfer and, optionally, one recipient registration."
      : "A refund transaction must contain only the requested USDC transfer.");
  }

  let transferCount = 0;
  let storageDeposit = 0n;
  let storageDepositCount = 0;
  for (const value of actions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The transaction includes an unsupported NEAR action.");
    const action = value as NearAction;
    const keys = Object.keys(action);
    if (keys.length !== 1 || keys[0] !== "FunctionCall" || !action.FunctionCall || typeof action.FunctionCall !== "object") {
      throw new Error("The transaction includes an unsupported NEAR action.");
    }
    const fn = action.FunctionCall as NearAction;
    if (typeof fn.method_name !== "string" || typeof fn.deposit !== "string" || !/^\d+$/.test(fn.deposit)) {
      throw new Error("The transaction includes an invalid function call.");
    }
    const deposit = BigInt(fn.deposit);
    const args = callArgs(fn);

    if (fn.method_name === "ft_transfer") {
      transferCount += 1;
      if (transferCount > 1) throw new Error("The transaction must contain exactly one USDC transfer.");
      if (deposit !== 1n) throw new Error("The USDC transfer must attach exactly one yoctoNEAR.");
      if (typeof args.receiver_id !== "string" || args.receiver_id.toLowerCase() !== expected.recipient.toLowerCase()) {
        throw new Error("The USDC transfer destination does not match the requested recipient.");
      }
      if (typeof args.amount !== "string" || args.amount !== expected.amount) {
        throw new Error("The USDC transfer amount does not match the requested amount.");
      }
      if (expected.memo !== null && args.memo !== expected.memo) {
        throw new Error("The USDC transfer memo does not match the requested reference.");
      }
      continue;
    }

    if (fn.method_name !== "storage_deposit" || !allowRecipientStorageDeposit) {
      throw new Error("The transaction contains a call outside the requested USDC transfer.");
    }
    storageDepositCount += 1;
    if (storageDepositCount > 1) throw new Error("The transaction can register the recipient only once.");
    if (deposit <= 0n) throw new Error("Recipient registration must attach a positive NEP-141 storage deposit.");
    if (typeof args.account_id !== "string" || args.account_id.toLowerCase() !== expected.recipient.toLowerCase() || args.registration_only !== true) {
      throw new Error("The token-account registration must apply only to the requested recipient.");
    }
    storageDeposit = deposit;
  }

  if (transferCount !== 1) throw new Error("The transaction must contain exactly one requested USDC transfer.");
  return storageDeposit;
}

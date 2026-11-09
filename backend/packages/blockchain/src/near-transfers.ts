import { connect, keyStores, KeyPair, transactions } from "near-api-js";
import { loadNearNetworks, type NearNetworkId } from "@zetra/config";

const YOCTO_PER_NEAR = 10n ** 24n;
const ONE_YOCTO = 1n;
const FT_GAS = 100n * 10n ** 12n;

export interface NearTransferInput {
  networkId: NearNetworkId;
  signerId: string;
  privateKey: string;
  tokenContract: string;
  receiverId: string;
  amount: bigint;
  memo?: string;
}

export interface NearTransferResult {
  txHash: string;
  blockHash: string | null;
  gasBurnt: bigint | null;
  tokensBurnt: bigint | null;
  feeYoctonear: bigint | null;
  raw: unknown;
}

const accountPattern = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function network(networkId: NearNetworkId) {
  const found = loadNearNetworks().find((candidate) => candidate.id === networkId);
  if (!found) throw new Error(`Unknown NEAR network: ${networkId}`);
  return found;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

/**
 * Send one NEP-141 transfer and wait for FINAL. The private key is supplied by the worker's
 * runtime secret boundary and is never logged or written to Zetra's database.
 */
export async function sendFt(input: NearTransferInput): Promise<NearTransferResult> {
  const net = network(input.networkId);
  if (!net.enabled) throw new Error(`NEAR network ${input.networkId} is not enabled for this deployment`);
  if (!accountPattern.test(input.signerId) || !accountPattern.test(input.receiverId)) throw new Error("Invalid NEAR signer or receiver account");
  if (!input.privateKey.startsWith("ed25519:")) throw new Error("NEAR payout signer key must be an ed25519 key");
  if (!accountPattern.test(input.tokenContract)) throw new Error("Invalid NEP-141 token contract account");
  if (input.amount <= 0n) throw new Error("NEAR transfer amount must be positive");
  if (input.signerId === input.receiverId) throw new Error("NEAR transfer recipient must differ from the signer");

  const store = new keyStores.InMemoryKeyStore();
  await store.setKey(net.environment === "live" ? "mainnet" : "testnet", input.signerId, KeyPair.fromString(input.privateKey as never));
  const near = await connect({
    networkId: net.environment === "live" ? "mainnet" : "testnet",
    nodeUrl: net.rpcUrl,
    deps: { keyStore: store }
  });
  const account = await near.account(input.signerId);
  // The legacy Account#functionCall helper uses EXECUTED_OPTIMISTIC. Outbound money must not be
  // marked confirmed until the transfer receipt is final, so use the explicit transaction API.
  const outcome = await account.signAndSendTransaction({
    receiverId: input.tokenContract,
    actions: [transactions.functionCall(
      "ft_transfer",
      { receiver_id: input.receiverId, amount: input.amount.toString(), ...(input.memo ? { memo: input.memo } : {}) },
      FT_GAS,
      ONE_YOCTO
    )],
    waitUntil: "FINAL"
  });
  const tx = (outcome as unknown as Record<string, any>).transaction ?? {};
  const txOutcome = (outcome as unknown as Record<string, any>).transaction_outcome?.outcome ?? {};
  const receiptOutcomes = Array.isArray((outcome as unknown as Record<string, any>).receipts_outcome)
    ? ((outcome as unknown as Record<string, any>).receipts_outcome as Array<Record<string, any>>).map((receipt) => receipt.outcome ?? {})
    : [];
  const outcomes = [txOutcome, ...receiptOutcomes];
  const total = (field: "gas_burnt" | "tokens_burnt") => {
    const values = outcomes.map((item) => integer(item[field])).filter((value): value is bigint => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0n) : null;
  };
  const gasBurnt = total("gas_burnt");
  const tokensBurnt = total("tokens_burnt");
  const txHash = text(tx.hash);
  if (!txHash) throw new Error("NEAR RPC did not return a transaction hash for the finalized transfer");
  return {
    txHash,
    blockHash: text(txOutcome.block_hash) ?? text(tx.block_hash),
    gasBurnt,
    tokensBurnt,
    feeYoctonear: tokensBurnt,
    raw: outcome
  };
}

export function payoutSignerFor(networkId: NearNetworkId): { signerId: string; privateKey: string } | null {
  const prefix = networkId === "near:mainnet" ? "NEAR_MAINNET" : "NEAR_TESTNET";
  const signerId = process.env[`${prefix}_PAYOUT_SIGNER_ID`]?.trim().toLowerCase();
  const privateKey = process.env[`${prefix}_PAYOUT_PRIVATE_KEY`]?.trim();
  return signerId && privateKey ? { signerId, privateKey } : null;
}

export { YOCTO_PER_NEAR };

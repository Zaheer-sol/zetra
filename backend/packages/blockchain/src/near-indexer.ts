import { NearRpcClient, type NearBlockReference } from "./near-rpc";
import { extractFinalFtTransfers, type NearFtTransferEvent } from "./near-events";

export interface NearFtTransferCandidate {
  transactionHash: string;
  senderAccountId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeArgs(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Filters included transactions to standard NEP-141 ft_transfer calls targeting monitored accounts.
 * The event emitted by the token contract is still required as authoritative transfer evidence.
 */
export function findNearFtTransferCandidates(
  transactions: readonly unknown[],
  acceptedTokenContracts: ReadonlySet<string>,
  monitoredAccounts: ReadonlySet<string>
): NearFtTransferCandidate[] {
  const candidates = new Map<string, NearFtTransferCandidate>();
  for (const transaction of transactions) {
    if (!isRecord(transaction) || !Array.isArray(transaction.actions)) continue;
    const hash = transaction.hash;
    const signerId = transaction.signer_id;
    const tokenContractId = transaction.receiver_id;
    if (typeof hash !== "string" || typeof signerId !== "string" || typeof tokenContractId !== "string") continue;
    if (!acceptedTokenContracts.has(tokenContractId)) continue;
    for (const action of transaction.actions) {
      if (!isRecord(action) || !isRecord(action.FunctionCall)) continue;
      if (action.FunctionCall.method_name !== "ft_transfer") continue;
      const args = decodeArgs(action.FunctionCall.args);
      if (typeof args?.receiver_id !== "string" || !monitoredAccounts.has(args.receiver_id)) continue;
      const previous = candidates.get(hash);
      if (previous && previous.senderAccountId !== signerId) {
        throw new Error(`NEAR block contains conflicting signers for transaction ${hash}`);
      }
      candidates.set(hash, { transactionHash: hash, senderAccountId: signerId });
    }
  }
  return [...candidates.values()];
}

export interface NearBlockTransferReport {
  block: NearBlockReference;
  transactionsChecked: number;
  transfers: NearFtTransferEvent[];
}

/** Fetches finalized shard chunks, follows only matching standard FT calls, then verifies FINAL outcomes. */
export async function scanNearFinalBlock(
  rpc: NearRpcClient,
  block: NearBlockReference,
  acceptedTokenContracts: ReadonlySet<string>,
  monitoredAccounts: ReadonlySet<string>
): Promise<NearBlockTransferReport> {
  const transactions: unknown[] = [];
  // Keep public-RPC pressure bounded. A private RPC can be configured for higher-throughput
  // backfills, but the default endpoint must not burst one request per shard and get rate-limited.
  for (const chunk of block.chunks) {
    const payload = await rpc.getChunk(chunk.hash);
    transactions.push(...payload.transactions);
  }
  const candidates = findNearFtTransferCandidates(transactions, acceptedTokenContracts, monitoredAccounts);
  const transfers: NearFtTransferEvent[] = [];
  for (const candidate of candidates) {
    const result = await rpc.getFinalTransactionStatus(candidate.transactionHash, candidate.senderAccountId);
    transfers.push(
      ...extractFinalFtTransfers(result, acceptedTokenContracts).filter((transfer) => monitoredAccounts.has(transfer.receiverAccountId))
    );
  }
  return { block, transactionsChecked: candidates.length, transfers };
}

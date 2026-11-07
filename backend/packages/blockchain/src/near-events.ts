const EVENT_PREFIX = "EVENT_JSON:";

interface ReceiptExecution {
  id: string;
  blockHash: string;
  executorId: string;
  status: Record<string, unknown>;
  logs: string[];
}

export interface NearFtTransferEvent {
  transactionHash: string;
  outcomeId: string;
  executionKind: "transaction" | "receipt";
  blockHash: string;
  tokenContractId: string;
  senderAccountId: string;
  receiverAccountId: string;
  amount: bigint;
  memo?: string;
  logIndex: number;
  transferIndex: number;
  eventLog: string;
}

export class NearEventError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NearEventError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NearEventError(`NEAR execution result has an invalid ${field}`);
  }
  return value;
}

function execution(value: unknown, field: string): ReceiptExecution {
  if (!isRecord(value) || !isRecord(value.outcome)) {
    throw new NearEventError(`NEAR execution result has an invalid ${field}`);
  }
  const outcome = value.outcome;
  if (!isRecord(outcome.status) || !Array.isArray(outcome.logs) || !outcome.logs.every((log) => typeof log === "string")) {
    throw new NearEventError(`NEAR execution result has invalid status or logs for ${field}`);
  }
  return {
    id: requiredString(value.id, `${field} ID`),
    blockHash: requiredString(value.block_hash, `${field} block hash`),
    executorId: requiredString(outcome.executor_id, `${field} executor account ID`),
    status: outcome.status,
    logs: outcome.logs
  };
}

function succeeded(status: Record<string, unknown>): boolean {
  return "SuccessValue" in status || "SuccessReceiptId" in status;
}

function decodeLog(
  eventLog: string,
  tokenContractId: string,
  provenance: Omit<NearFtTransferEvent, "tokenContractId" | "senderAccountId" | "receiverAccountId" | "amount" | "logIndex" | "transferIndex" | "eventLog">,
  logIndex: number
): NearFtTransferEvent[] {
  let event: unknown;
  try {
    event = JSON.parse(eventLog.slice(EVENT_PREFIX.length).trim());
  } catch (error) {
    throw new NearEventError(`Malformed NEAR event log at index ${logIndex}`, { cause: error });
  }
  if (!isRecord(event) || event.standard !== "nep141" || event.event !== "ft_transfer") return [];
  if (event.version !== "1.0.0") {
    throw new NearEventError(`Unsupported NEP-141 event version: ${String(event.version)}`);
  }
  if (!Array.isArray(event.data)) {
    throw new NearEventError(`NEP-141 ft_transfer event at index ${logIndex} has invalid data`);
  }

  return event.data.map((entry, transferIndex) => {
    if (!isRecord(entry)) throw new NearEventError(`NEP-141 transfer ${transferIndex} at log ${logIndex} is invalid`);
    const rawAmount = requiredString(entry.amount, `NEP-141 transfer ${transferIndex} amount`);
    if (!/^(0|[1-9]\d*)$/.test(rawAmount)) {
      throw new NearEventError(`NEP-141 transfer ${transferIndex} amount is not an unsigned integer`);
    }
    return {
      ...provenance,
      tokenContractId,
      senderAccountId: requiredString(entry.old_owner_id, `NEP-141 transfer ${transferIndex} sender`),
      receiverAccountId: requiredString(entry.new_owner_id, `NEP-141 transfer ${transferIndex} receiver`),
      amount: BigInt(rawAmount),
      ...(typeof entry.memo === "string" ? { memo: entry.memo } : {}),
      logIndex,
      transferIndex,
      eventLog
    };
  });
}

/**
 * Extracts successful NEP-141 transfer events from a finalized transaction result.
 * The caller supplies the approved token contract IDs; this function does not infer a token from
 * its symbol or accept events emitted by arbitrary contracts.
 */
export function extractFinalFtTransfers(
  result: Record<string, unknown>,
  acceptedTokenContracts: ReadonlySet<string>
): NearFtTransferEvent[] {
  if (result.final_execution_status !== "FINAL") {
    throw new NearEventError("NEAR transaction has not reached FINAL execution");
  }
  const transaction = result.transaction;
  if (!isRecord(transaction)) throw new NearEventError("NEAR transaction result has no transaction");
  const transactionHash = requiredString(transaction.hash, "transaction hash");
  const transactionOutcome = execution(result.transaction_outcome, "transaction outcome");
  if (!Array.isArray(result.receipts_outcome)) throw new NearEventError("NEAR transaction result has no receipt outcomes");
  const receipts = result.receipts_outcome.map((receipt, index) => execution(receipt, `receipt outcome ${index}`));
  const executions: Array<{ value: ReceiptExecution; kind: "transaction" | "receipt" }> = [
    { value: transactionOutcome, kind: "transaction" },
    ...receipts.map((value) => ({ value, kind: "receipt" as const }))
  ];

  const transfers: NearFtTransferEvent[] = [];
  for (const { value, kind } of executions) {
    if (!succeeded(value.status) || !acceptedTokenContracts.has(value.executorId)) continue;
    for (const [logIndex, eventLog] of value.logs.entries()) {
      if (!eventLog.startsWith(EVENT_PREFIX)) continue;
      transfers.push(...decodeLog(eventLog, value.executorId, {
        transactionHash,
        outcomeId: value.id,
        executionKind: kind,
        blockHash: value.blockHash
      }, logIndex));
    }
  }
  return transfers;
}

/** Extracts successful token events from receipt executions already included in a finalized block. */
export function extractFinalReceiptFtTransfers(
  transactionHash: string,
  receiptOutcomes: readonly unknown[],
  acceptedTokenContracts: ReadonlySet<string>
): NearFtTransferEvent[] {
  const hash = requiredString(transactionHash, "transaction hash");
  const receipts = receiptOutcomes.map((receipt, index) => execution(receipt, `receipt outcome ${index}`));
  const transfers: NearFtTransferEvent[] = [];
  for (const value of receipts) {
    if (!succeeded(value.status) || !acceptedTokenContracts.has(value.executorId)) continue;
    for (const [logIndex, eventLog] of value.logs.entries()) {
      if (!eventLog.startsWith(EVENT_PREFIX)) continue;
      transfers.push(...decodeLog(eventLog, value.executorId, {
        transactionHash: hash,
        outcomeId: value.id,
        executionKind: "receipt",
        blockHash: value.blockHash
      }, logIndex));
    }
  }
  return transfers;
}

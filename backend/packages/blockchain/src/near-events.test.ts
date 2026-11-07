import { describe, expect, it } from "vitest";
import { extractFinalFtTransfers, NearEventError } from "./near-events";

const token = "usd.token.testnet";
const transferLog = (data: unknown[]) => `EVENT_JSON:${JSON.stringify({
  standard: "nep141",
  version: "1.0.0",
  event: "ft_transfer",
  data
})}`;

function executionResult(options: {
  status?: Record<string, unknown>;
  executorId?: string;
  blockHash?: string;
  logs?: string[];
  id?: string;
} = {}): Record<string, unknown> {
  return {
    id: options.id ?? "outcome-id",
    block_hash: options.blockHash ?? "block-hash",
    outcome: {
      executor_id: options.executorId ?? token,
      status: options.status ?? { SuccessValue: "" },
      logs: options.logs ?? []
    }
  };
}

function transactionResult(receipts: unknown[] = [], transactionLogs: string[] = []): Record<string, unknown> {
  return {
    final_execution_status: "FINAL",
    transaction: { hash: "transaction-hash" },
    transaction_outcome: executionResult({ id: "transaction-outcome", logs: transactionLogs }),
    receipts_outcome: receipts
  };
}

describe("extractFinalFtTransfers", () => {
  it("extracts transfer events from successful transaction and receipt outcomes with exact integer amounts", () => {
    const result = transactionResult(
      [executionResult({
        id: "receipt-id",
        blockHash: "receipt-block",
        logs: [transferLog([{ old_owner_id: "payer.testnet", new_owner_id: "merchant.testnet", amount: "900719925474099312345" }])]
      })],
      [transferLog([{ old_owner_id: "payer.testnet", new_owner_id: "merchant.testnet", amount: "25" }])]
    );

    expect(extractFinalFtTransfers(result, new Set([token]))).toEqual([
      expect.objectContaining({
        transactionHash: "transaction-hash",
        outcomeId: "transaction-outcome",
        executionKind: "transaction",
        blockHash: "block-hash",
        tokenContractId: token,
        senderAccountId: "payer.testnet",
        receiverAccountId: "merchant.testnet",
        amount: 25n,
        logIndex: 0,
        transferIndex: 0
      }),
      expect.objectContaining({
        outcomeId: "receipt-id",
        executionKind: "receipt",
        blockHash: "receipt-block",
        amount: 900719925474099312345n
      })
    ]);
  });

  it("ignores unapproved token contracts, unrelated events, and failed executions", () => {
    const result = transactionResult([
      executionResult({ executorId: "unapproved.token.testnet", logs: [transferLog([{ old_owner_id: "a", new_owner_id: "b", amount: "1" }])] }),
      executionResult({ status: { Failure: { error_message: "failed" } }, logs: [transferLog([{ old_owner_id: "a", new_owner_id: "b", amount: "1" }])] }),
      executionResult({ logs: [`EVENT_JSON:${JSON.stringify({ standard: "nep297", version: "1.0.0", event: "something", data: [] })}`] })
    ]);

    expect(extractFinalFtTransfers(result, new Set([token]))).toEqual([]);
  });

  it("requires finalized execution", () => {
    expect(() => extractFinalFtTransfers({ ...transactionResult(), final_execution_status: "EXECUTED_OPTIMISTIC" }, new Set([token])))
      .toThrow(/FINAL execution/);
  });

  it("rejects malformed matching events instead of silently treating them as evidence", () => {
    const malformedJson = transactionResult([], ["EVENT_JSON:{"]);
    const malformedAmount = transactionResult([], [transferLog([{ old_owner_id: "payer.testnet", new_owner_id: "merchant.testnet", amount: "1.5" }])]);

    expect(() => extractFinalFtTransfers(malformedJson, new Set([token]))).toThrow(NearEventError);
    expect(() => extractFinalFtTransfers(malformedAmount, new Set([token]))).toThrow(/unsigned integer/);
  });
});

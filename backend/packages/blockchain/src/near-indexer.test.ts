import { describe, expect, it } from "vitest";
import type { NearNetworkConfig } from "@zetra/config";
import { NearRpcClient } from "./near-rpc";
import { findNearFtTransferCandidates, scanNearFinalBlock } from "./near-indexer";

const token = "usd.token.testnet";
const receiver = "merchant.testnet";
const encodedArgs = (args: unknown) => Buffer.from(JSON.stringify(args)).toString("base64");
const network: NearNetworkConfig = {
  id: "near:testnet",
  environment: "test",
  name: "NEAR Testnet",
  rpcUrl: "https://rpc.testnet.near.org",
  dataUrl: "https://testnet.neardata.xyz",
  explorerUrl: "https://testnet.nearblocks.io",
  finality: "final",
  enabled: false,
  startHeight: 0n,
  assets: []
};

describe("findNearFtTransferCandidates", () => {
  it("finds direct NEP-141 calls to monitored accounts and deduplicates action candidates", () => {
    const result = findNearFtTransferCandidates([
      {
        hash: "tx-1",
        signer_id: "payer.testnet",
        receiver_id: token,
        actions: [
          { FunctionCall: { method_name: "ft_transfer", args: encodedArgs({ receiver_id: receiver, amount: "12", memo: "invoice-1" }) } },
          { FunctionCall: { method_name: "ft_transfer", args: encodedArgs({ receiver_id: receiver, amount: "13" }) } }
        ]
      }
    ], new Set([token]), new Set([receiver]));

    expect(result).toEqual([{ transactionHash: "tx-1", senderAccountId: "payer.testnet" }]);
  });

  it("ignores other tokens, methods, unmonitored recipients, and malformed transactions", () => {
    const transactions = [
      { hash: "wrong-token", signer_id: "payer.testnet", receiver_id: "other.token", actions: [{ FunctionCall: { method_name: "ft_transfer", args: encodedArgs({ receiver_id: receiver }) } }] },
      { hash: "wrong-method", signer_id: "payer.testnet", receiver_id: token, actions: [{ FunctionCall: { method_name: "ft_transfer_call", args: encodedArgs({ receiver_id: receiver }) } }] },
      { hash: "wrong-recipient", signer_id: "payer.testnet", receiver_id: token, actions: [{ FunctionCall: { method_name: "ft_transfer", args: encodedArgs({ receiver_id: "other.testnet" }) } }] },
      { hash: "bad-args", signer_id: "payer.testnet", receiver_id: token, actions: [{ FunctionCall: { method_name: "ft_transfer", args: "not-base64" } }] },
      null
    ];

    expect(findNearFtTransferCandidates(transactions, new Set([token]), new Set([receiver]))).toEqual([]);
  });

  it("does not mistake the transaction signer for the actual token transfer sender", () => {
    const [candidate] = findNearFtTransferCandidates([
      { hash: "relayed", signer_id: "relayer.testnet", receiver_id: token, actions: [{ FunctionCall: { method_name: "ft_transfer", args: encodedArgs({ receiver_id: receiver }) } }] }
    ], new Set([token]), new Set([receiver]));

    expect(candidate?.senderAccountId).toBe("relayer.testnet");
  });

  it("scans a finalized block, follows candidate transactions to FINAL execution, and emits verified transfers", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
      calls.push(request);
      const result = request.method === "chunk"
        ? {
            transactions: [
              {
                hash: "tx-hash",
                signer_id: "payer.testnet",
                receiver_id: token,
                actions: [{ FunctionCall: { method_name: "ft_transfer", args: encodedArgs({ receiver_id: receiver, amount: "12", memo: "invoice-1" }) } }]
              }
            ],
            receipts: []
          }
        : {
            final_execution_status: "FINAL",
            transaction: { hash: "tx-hash", signer_id: "payer.testnet" },
            transaction_outcome: {
              id: "outcome-id",
              block_hash: "final-block-hash",
              outcome: {
                executor_id: token,
                status: { SuccessValue: "" },
                logs: [`EVENT_JSON:${JSON.stringify({
                  standard: "nep141",
                  version: "1.0.0",
                  event: "ft_transfer",
                  data: [{ old_owner_id: "payer.testnet", new_owner_id: receiver, amount: "12", memo: "invoice-1" }]
                })}`]
              }
            },
            receipts_outcome: []
          };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { status: 200 });
    };
    const rpc = new NearRpcClient(network, { fetcher });
    const block = {
      height: 100n,
      hash: "final-block-hash",
      previousHash: "parent-hash",
      timestampNanoseconds: 1_800_000_000_000_000_000n,
      chunks: [{ hash: "chunk-hash", shardId: 0 }]
    };

    const report = await scanNearFinalBlock(rpc, block, new Set([token]), new Set([receiver]));

    expect(report.transactionsChecked).toBe(1);
    expect(report.transfers).toEqual([
      expect.objectContaining({
        transactionHash: "tx-hash",
        senderAccountId: "payer.testnet",
        receiverAccountId: receiver,
        tokenContractId: token,
        amount: 12n,
        memo: "invoice-1",
        blockHash: "final-block-hash"
      })
    ]);
    expect(calls.map((call) => call.method)).toEqual(["chunk", "tx"]);
    expect(calls[1]?.params).toMatchObject({
      tx_hash: "tx-hash",
      sender_account_id: "payer.testnet",
      wait_until: "FINAL"
    });
  });
});

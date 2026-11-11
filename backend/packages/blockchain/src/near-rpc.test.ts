import { describe, expect, it, vi } from "vitest";
import type { NearNetworkConfig } from "@zetra/config";
import { NearRpcClient, NearRpcError } from "./near-rpc";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("NearRpcClient", () => {
  it("requests only finalized blocks and preserves nanosecond timestamps", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        header: { height: 190000000, hash: "block-hash", prev_hash: "parent-hash", timestamp_nanosec: "1760000000123456789" },
        chunks: [{ chunk_hash: "chunk-hash", shard_id: 4 }]
      }
    }));
    const client = new NearRpcClient(network, { fetcher });

    await expect(client.getFinalBlock()).resolves.toEqual({
      height: 190000000n,
      hash: "block-hash",
      previousHash: "parent-hash",
      timestampNanoseconds: 1760000000123456789n,
      chunks: [{ hash: "chunk-hash", shardId: 4 }]
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      method: "block",
      params: { finality: "final" }
    });
  });

  it("retrieves a specific height and receipt execution block by stable block identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; params: Record<string, unknown> };
      const isHeight = request.params.block_id === 190000000;
      return jsonResponse({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          header: {
            height: 190000000,
            hash: isHeight ? "block-hash" : "receipt-block-hash",
            prev_hash: "parent-hash",
            timestamp_nanosec: "1760000000123456789"
          },
          chunks: []
        }
      });
    });
    const client = new NearRpcClient(network, { fetcher });

    await expect(client.getFinalBlockByHeight(190000000n)).resolves.toMatchObject({ height: 190000000n, hash: "block-hash" });
    await expect(client.getFinalBlockByHash("receipt-block-hash")).resolves.toMatchObject({ hash: "receipt-block-hash" });
    expect(fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).params.block_id)).toEqual([
      190000000,
      "receipt-block-hash"
    ]);
    await expect(client.getFinalBlockByHeight(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).rejects.toThrow(/safe-integer/);
  });

  it("requests the chunk payload for the chosen block and shard", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: { transactions: [{ hash: "tx" }], receipts: [{ receipt_id: "receipt" }] }
    }));
    const client = new NearRpcClient(network, { fetcher });

    await expect(client.getChunk("chunk-hash")).resolves.toMatchObject({
      transactions: [{ hash: "tx" }],
      receipts: [{ receipt_id: "receipt" }]
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      method: "chunk",
      params: { chunk_id: "chunk-hash" }
    });
  });

  it("waits for FINAL transaction execution and receipts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        final_execution_status: "FINAL",
        transaction: { hash: "tx-hash", signer_id: "sender.testnet" },
        status: { SuccessValue: "" }
      }
    }));
    const client = new NearRpcClient(network, { fetcher });

    await client.getFinalTransactionStatus("tx-hash", "sender.testnet");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      method: "tx",
      params: { tx_hash: "tx-hash", sender_account_id: "sender.testnet", wait_until: "FINAL" }
    });
  });

  it("rejects a finalized response with a different hash or signer", async () => {
    const wrongHash = new NearRpcClient(network, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        jsonrpc: "2.0", id: 1,
        result: { final_execution_status: "FINAL", transaction: { hash: "other-hash", signer_id: "sender.testnet" } }
      }))
    });
    const wrongSigner = new NearRpcClient(network, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        jsonrpc: "2.0", id: 1,
        result: { final_execution_status: "FINAL", transaction: { hash: "tx-hash", signer_id: "other.testnet" } }
      }))
    });

    await expect(wrongHash.getFinalTransactionStatus("tx-hash", "sender.testnet")).rejects.toThrow(/different transaction hash/);
    await expect(wrongSigner.getFinalTransactionStatus("tx-hash", "sender.testnet")).rejects.toThrow(/different signer/);
  });

  it("surfaces non-retryable RPC errors without returning a success-shaped fallback", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32602, message: "Invalid params" }
    }));
    const client = new NearRpcClient(network, { fetcher });

    await expect(client.getFinalBlock()).rejects.toMatchObject({
      name: "NearRpcError",
      message: "Invalid params",
      retryable: false,
      code: -32602
    });
  });

  it("marks transient HTTP and transport failures retryable", async () => {
    const serviceUnavailable = new NearRpcClient(network, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 }))
    });
    const offline = new NearRpcClient(network, {
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"))
    });

    await expect(serviceUnavailable.getFinalBlock()).rejects.toMatchObject({ retryable: true, httpStatus: 503 });
    await expect(offline.getFinalBlock()).rejects.toMatchObject({ retryable: true });
  });

  it("rejects mismatched response IDs and malformed finalized block data", async () => {
    const mismatched = new NearRpcClient(network, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ jsonrpc: "2.0", id: 99, result: {} }))
    });
    const malformed = new NearRpcClient(network, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { header: { height: "bad" }, chunks: [] }
      }))
    });

    await expect(mismatched.getFinalBlock()).rejects.toBeInstanceOf(NearRpcError);
    await expect(malformed.getFinalBlock()).rejects.toThrow(/block height/);
  });

  it("rejects unsafe JSON numbers rather than silently rounding NEAR timestamps", async () => {
    const unsafe = new NearRpcClient(network, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          header: {
            height: 190000000,
            hash: "block-hash",
            prev_hash: "parent-hash",
            timestamp_nanosec: 1760000000123456789
          },
          chunks: []
        }
      }))
    });

    await expect(unsafe.getFinalBlock()).rejects.toThrow(/block timestamp/);
  });
});

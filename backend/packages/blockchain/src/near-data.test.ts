import { describe, expect, it } from "vitest";
import type { NearNetworkConfig } from "@zetra/config";
import { NearDataClient, NearDataError } from "./near-data";

const token = "usdc.fakes.testnet";
const merchant = "merchant.testnet";
const eventLog = `EVENT_JSON:${JSON.stringify({
  standard: "nep141",
  version: "1.0.0",
  event: "ft_transfer",
  data: [{ old_owner_id: "payer.testnet", new_owner_id: merchant, amount: "2500000", memo: "zetra:invoice-token" }]
})}`;

const network: NearNetworkConfig = {
  id: "near:testnet",
  environment: "test",
  name: "NEAR Testnet",
  rpcUrl: "https://rpc.testnet.near.org",
  dataUrl: "https://testnet.neardata.xyz",
  explorerUrl: "https://testnet.nearblocks.io",
  finality: "final",
  enabled: true,
  startHeight: 100n,
  assets: []
};

function hydratedBlock(blockHash = "block-hash") {
  return {
    block: {
      header: {
        height: 101,
        prev_height: 100,
        hash: blockHash,
        prev_hash: "parent-hash",
        timestamp_nanosec: "1800000000000000000"
      }
    },
    shards: [{
      receipt_execution_outcomes: [{
        tx_hash: "transaction-hash",
        execution_outcome: {
          id: "receipt-id",
          block_hash: blockHash,
          outcome: {
            executor_id: token,
            status: { SuccessValue: "" },
            logs: [eventLog]
          }
        }
      }]
    }]
  };
}

describe("NearDataClient", () => {
  it("extracts a monitored, finalized NEP-141 transfer from one hydrated block request", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), authorization: headers.get("authorization") });
      return new Response(JSON.stringify(hydratedBlock()), { status: 200 });
    };
    const client = new NearDataClient(network, { fetcher, apiKey: "secret-key", minRequestIntervalMs: 0 });

    const report = await client.getFinalBlockByHeight(101n, new Set([token]), new Set([merchant]));

    expect(requests).toEqual([{
      url: "https://testnet.neardata.xyz/v0/block/101",
      authorization: "Bearer secret-key"
    }]);
    expect(report.block).toMatchObject({ height: 101n, hash: "block-hash", previousHash: "parent-hash" });
    expect(report.transfers).toEqual([expect.objectContaining({
      transactionHash: "transaction-hash",
      outcomeId: "receipt-id",
      executionKind: "receipt",
      tokenContractId: token,
      senderAccountId: "payer.testnet",
      receiverAccountId: merchant,
      amount: 2500000n,
      memo: "zetra:invoice-token"
    })]);
  });

  it("ignores unmonitored recipients and rejects mismatched block provenance", async () => {
    const ignored = new NearDataClient(network, {
      fetcher: async () => new Response(JSON.stringify(hydratedBlock()), { status: 200 }),
      minRequestIntervalMs: 0
    });
    expect((await ignored.getLatestFinalBlock(new Set([token]), new Set(["other.testnet"]))).transfers).toEqual([]);

    const mismatched = new NearDataClient(network, {
      fetcher: async () => new Response(JSON.stringify(hydratedBlock("different-block")), { status: 200 }),
      minRequestIntervalMs: 0
    });
    const document = hydratedBlock("different-block");
    document.shards[0]!.receipt_execution_outcomes[0]!.execution_outcome.block_hash = "wrong-block";
    const invalid = new NearDataClient(network, {
      fetcher: async () => new Response(JSON.stringify(document), { status: 200 }),
      minRequestIntervalMs: 0
    });

    await expect(mismatched.getFinalBlockByHeight(102n, new Set([token]), new Set([merchant])))
      .rejects.toThrow(/different block height/);
    await expect(invalid.getLatestFinalBlock(new Set([token]), new Set([merchant])))
      .rejects.toThrow(NearDataError);
  });

  it("retries transient responses and then returns the finalized block", async () => {
    let calls = 0;
    const client = new NearDataClient(network, {
      fetcher: async () => {
        calls += 1;
        return calls < 3
          ? new Response("busy", { status: 429 })
          : new Response(JSON.stringify(hydratedBlock()), { status: 200 });
      },
      minRequestIntervalMs: 0,
      retryBaseMs: 1
    });

    const report = await client.getLatestFinalBlock(new Set([token]), new Set([merchant]));
    expect(calls).toBe(3);
    expect(report.block.height).toBe(101n);
  });

  it("distinguishes a missing block from a malformed hydrated block", async () => {
    const client = new NearDataClient(network, {
      fetcher: async () => new Response("null", { status: 200 }),
      minRequestIntervalMs: 0
    });
    await expect(client.getFinalBlockByHeight(101n, new Set(), new Set())).rejects.toMatchObject({
      name: "NearDataMissingBlockError",
      height: 101n
    });
    await expect(client.getLatestFinalBlock(new Set(), new Set())).rejects.toThrow(/invalid hydrated block/);
  });
});

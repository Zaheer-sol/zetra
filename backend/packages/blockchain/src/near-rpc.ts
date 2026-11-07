import type { NearNetworkConfig } from "@zetra/config";

export interface NearBlockReference {
  height: bigint;
  previousHeight?: bigint;
  hash: string;
  previousHash: string;
  timestampNanoseconds: bigint;
  chunks: Array<{ hash: string; shardId: number }>;
}

export interface NearChunk {
  transactions: unknown[];
  receipts: unknown[];
  raw: Record<string, unknown>;
}

interface NearRpcOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class NearRpcError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: number,
    readonly httpStatus?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "NearRpcError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInteger(value: unknown, field: string): bigint {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) {
    throw new NearRpcError(`NEAR RPC returned an invalid ${field}`, false);
  }
  return BigInt(value);
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NearRpcError(`NEAR RPC returned an invalid ${field}`, false);
  }
  return value;
}

export class NearRpcClient {
  private nextId = 0;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    readonly network: NearNetworkConfig,
    options: NearRpcOptions = {}
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("NEAR RPC timeout must be a positive integer");
    }
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.requestOnce(method, params);
      } catch (error) {
        last = error;
        if (!(error instanceof NearRpcError) || !error.retryable || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
    throw last;
  }

  private async requestOnce(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.nextId;
    let response: Response;
    try {
      response = await this.fetcher(this.network.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new NearRpcError(`NEAR RPC transport failed for ${method}`, true, undefined, undefined, { cause: error });
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new NearRpcError(`Could not read the NEAR RPC response for ${method}`, true, undefined, response.status, { cause: error });
    }

    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new NearRpcError(`NEAR RPC returned HTTP ${response.status} for ${method}`, retryable, undefined, response.status);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new NearRpcError(`NEAR RPC returned invalid JSON for ${method}`, false, undefined, response.status, { cause: error });
    }
    if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== id) {
      throw new NearRpcError(`NEAR RPC returned an invalid response envelope for ${method}`, false, undefined, response.status);
    }

    if ("error" in payload) {
      if (!isRecord(payload.error)) {
        throw new NearRpcError(`NEAR RPC returned an invalid error for ${method}`, false, undefined, response.status);
      }
      const code = typeof payload.error.code === "number" ? payload.error.code : undefined;
      const message = typeof payload.error.message === "string" ? payload.error.message : `NEAR RPC error for ${method}`;
      throw new NearRpcError(message, code === -32603, code, response.status);
    }
    if (!("result" in payload)) {
      throw new NearRpcError(`NEAR RPC response for ${method} has no result`, false, undefined, response.status);
    }
    return payload.result;
  }

  async getFinalBlock(): Promise<NearBlockReference> {
    const result: unknown = await this.request("block", { finality: "final" });
    return this.parseBlock(result);
  }

  async getFinalBlockByHeight(height: bigint): Promise<NearBlockReference> {
    if (height < 0n) throw new Error("NEAR block height must be non-negative");
    if (height > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("NEAR block height is outside the JSON safe-integer range");
    // NEAR RPC distinguishes a numeric block height from a string block hash. Sending the height
    // as a decimal string is treated as a hash and rejected by the public RPC.
    const result: unknown = await this.request("block", { block_id: Number(height) });
    const block = this.parseBlock(result);
    if (block.height !== height) throw new NearRpcError("NEAR RPC returned a different block height than requested", false);
    return block;
  }

  async getFinalBlockByHash(hash: string): Promise<NearBlockReference> {
    if (!hash) throw new Error("NEAR block hash is required");
    const result: unknown = await this.request("block", { block_id: hash });
    const block = this.parseBlock(result);
    if (block.hash !== hash) throw new NearRpcError("NEAR RPC returned a different block hash than requested", false);
    return block;
  }

  private parseBlock(result: unknown): NearBlockReference {
    if (!isRecord(result) || !isRecord(result.header) || !Array.isArray(result.chunks)) {
      throw new NearRpcError("NEAR RPC returned an invalid final block", false);
    }
    const chunks = result.chunks.map((chunk, index) => {
      if (!isRecord(chunk)) throw new NearRpcError(`NEAR RPC returned an invalid chunk reference at index ${index}`, false);
      const shardId = parseInteger(chunk.shard_id, `chunk ${index} shard ID`);
      if (shardId > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new NearRpcError(`NEAR RPC returned an out-of-range shard ID at index ${index}`, false);
      }
      return { hash: parseString(chunk.chunk_hash, `chunk ${index} hash`), shardId: Number(shardId) };
    });

    return {
      height: parseInteger(result.header.height, "block height"),
      hash: parseString(result.header.hash, "block hash"),
      previousHash: parseString(result.header.prev_hash, "previous block hash"),
      timestampNanoseconds: parseInteger(result.header.timestamp_nanosec, "block timestamp"),
      chunks
    };
  }

  async getChunk(chunkHash: string): Promise<NearChunk> {
    if (!chunkHash) throw new Error("NEAR chunk hash is required");
    // Block responses already give us the immutable chunk hash. Asking by chunk_id avoids mixing a
    // chunk hash into the separate { block_id, shard_id } request shape.
    const result: unknown = await this.request("chunk", { chunk_id: chunkHash });
    if (!isRecord(result) || !Array.isArray(result.transactions) || !Array.isArray(result.receipts)) {
      throw new NearRpcError("NEAR RPC returned an invalid chunk", false);
    }
    return { transactions: result.transactions, receipts: result.receipts, raw: result };
  }

  async getFinalTransactionStatus(transactionHash: string, senderAccountId: string): Promise<Record<string, unknown>> {
    if (!transactionHash) throw new Error("NEAR transaction hash is required");
    if (!senderAccountId) throw new Error("NEAR sender account ID is required");
    const result: unknown = await this.request("tx", {
      tx_hash: transactionHash,
      sender_account_id: senderAccountId,
      wait_until: "FINAL"
    });
    if (!isRecord(result) || result.final_execution_status !== "FINAL") {
      throw new NearRpcError("NEAR RPC did not return finalized transaction execution", false);
    }
    return result;
  }
}

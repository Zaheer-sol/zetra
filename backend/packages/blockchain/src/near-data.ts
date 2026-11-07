import type { NearNetworkConfig } from "@zetra/config";
import { extractFinalReceiptFtTransfers, type NearFtTransferEvent } from "./near-events";
import type { NearBlockReference } from "./near-rpc";

export interface NearDataBlockReport {
  block: NearBlockReference;
  transfers: NearFtTransferEvent[];
}

interface NearDataOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  apiKey?: string;
  minRequestIntervalMs?: number;
  retryBaseMs?: number;
}

export class NearDataError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly httpStatus?: number,
    readonly retryAfterMs?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "NearDataError";
  }
}

export class NearDataMissingBlockError extends NearDataError {
  constructor(readonly height: bigint) {
    super(`NEAR Data has no block at height ${height}`, false);
    this.name = "NearDataMissingBlockError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NearDataError(`NEAR Data returned an invalid ${field}`, false);
  }
  return value;
}

function integer(value: unknown, field: string): bigint {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
    throw new NearDataError(`NEAR Data returned an invalid ${field}`, false);
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new NearDataError(`NEAR Data returned an unsafe ${field}`, false);
  }
  return BigInt(value);
}

/**
 * Reads FastNear's fully hydrated, finalized block documents. One request contains every shard,
 * receipt outcome and log required to prove NEP-141 transfers without an RPC request per shard.
 */
export class NearDataClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly minRequestIntervalMs: number;
  private readonly retryBaseMs: number;
  private nextRequestAt = 0;

  constructor(
    readonly network: NearNetworkConfig,
    options: NearDataOptions = {}
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.apiKey = options.apiKey?.trim() || undefined;
    // Anonymous access is intentionally conservative. A configured FastNear key can use its
    // account quota while still honoring server-provided Retry-After responses.
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? (this.apiKey ? 50 : 1_100);
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("NEAR Data timeout must be a positive integer");
    }
    if (!Number.isInteger(this.minRequestIntervalMs) || this.minRequestIntervalMs < 0) {
      throw new Error("NEAR Data minimum request interval must be a non-negative integer");
    }
    if (!Number.isInteger(this.retryBaseMs) || this.retryBaseMs < 0) {
      throw new Error("NEAR Data retry base must be a non-negative integer");
    }
  }

  async getLatestFinalBlock(
    acceptedTokenContracts: ReadonlySet<string>,
    monitoredAccounts: ReadonlySet<string>
  ): Promise<NearDataBlockReport> {
    return this.get("/v0/last_block/final", acceptedTokenContracts, monitoredAccounts);
  }

  async getFinalBlockByHeight(
    height: bigint,
    acceptedTokenContracts: ReadonlySet<string>,
    monitoredAccounts: ReadonlySet<string>
  ): Promise<NearDataBlockReport> {
    if (height < 0n) throw new Error("NEAR block height must be non-negative");
    return this.get(`/v0/block/${height}`, acceptedTokenContracts, monitoredAccounts, height);
  }

  private async get(
    path: string,
    acceptedTokenContracts: ReadonlySet<string>,
    monitoredAccounts: ReadonlySet<string>,
    expectedHeight?: bigint
  ): Promise<NearDataBlockReport> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const document = await this.getOnce(path);
        if (document === null && expectedHeight !== undefined) throw new NearDataMissingBlockError(expectedHeight);
        const report = this.parse(document, acceptedTokenContracts, monitoredAccounts);
        if (expectedHeight !== undefined && report.block.height !== expectedHeight) {
          throw new NearDataError("NEAR Data returned a different block height than requested", false);
        }
        return report;
      } catch (error) {
        lastError = error;
        if (!(error instanceof NearDataError) || !error.retryable || attempt === 2) throw error;
        const delay = Math.max(error.retryAfterMs ?? 0, this.retryBaseMs * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  private async getOnce(path: string): Promise<unknown> {
    const waitMs = this.nextRequestAt - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
    let response: Response;
    try {
      response = await this.fetcher(`${this.network.dataUrl}${path}`, {
        headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new NearDataError("NEAR Data transport failed", true, undefined, undefined, { cause: error });
    }
    if (!response.ok) {
      const retryable = response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500;
      const retryAfter = response.headers.get("retry-after");
      let retryAfterMs: number | undefined;
      if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
        retryAfterMs = Math.ceil(Number(retryAfter) * 1_000);
      } else if (retryAfter) {
        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) retryAfterMs = Math.max(0, retryAt - Date.now());
      }
      throw new NearDataError(`NEAR Data returned HTTP ${response.status}`, retryable, response.status, retryAfterMs);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new NearDataError("NEAR Data returned invalid JSON", false, response.status, undefined, { cause: error });
    }
  }

  private parse(
    document: unknown,
    acceptedTokenContracts: ReadonlySet<string>,
    monitoredAccounts: ReadonlySet<string>
  ): NearDataBlockReport {
    if (!isRecord(document) || !isRecord(document.block) || !isRecord(document.block.header) || !Array.isArray(document.shards)) {
      throw new NearDataError("NEAR Data returned an invalid hydrated block", false);
    }
    const header = document.block.header;
    const block: NearBlockReference = {
      height: integer(header.height, "block height"),
      ...(header.prev_height === undefined ? {} : { previousHeight: integer(header.prev_height, "previous block height") }),
      hash: requiredString(header.hash, "block hash"),
      previousHash: requiredString(header.prev_hash, "previous block hash"),
      timestampNanoseconds: integer(header.timestamp_nanosec, "block timestamp"),
      chunks: []
    };
    const transfers: NearFtTransferEvent[] = [];
    for (const [shardIndex, shard] of document.shards.entries()) {
      if (!isRecord(shard) || !Array.isArray(shard.receipt_execution_outcomes)) {
        throw new NearDataError(`NEAR Data returned invalid receipt outcomes for shard ${shardIndex}`, false);
      }
      for (const [outcomeIndex, wrapper] of shard.receipt_execution_outcomes.entries()) {
        if (!isRecord(wrapper) || !("execution_outcome" in wrapper)) {
          throw new NearDataError(`NEAR Data returned an invalid outcome at shard ${shardIndex}, index ${outcomeIndex}`, false);
        }
        const transactionHash = requiredString(wrapper.tx_hash, `transaction hash at shard ${shardIndex}, index ${outcomeIndex}`);
        const found = extractFinalReceiptFtTransfers(transactionHash, [wrapper.execution_outcome], acceptedTokenContracts);
        for (const transfer of found) {
          if (transfer.blockHash !== block.hash) {
            throw new NearDataError(`NEAR Data receipt outcome belongs to a different block at shard ${shardIndex}, index ${outcomeIndex}`, false);
          }
          if (monitoredAccounts.has(transfer.receiverAccountId)) transfers.push(transfer);
        }
      }
    }
    return { block, transfers };
  }
}

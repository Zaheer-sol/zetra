import { loadNearNetworks } from "@zetra/config";
import { NearDataClient, NearDataMissingBlockError, type NearDataBlockReport } from "@zetra/blockchain";
import { withSystem, withTenant } from "@zetra/database";
import { log } from "./context";
import { ingestObservation, type WalletRef } from "./pipeline";

interface NearWallet extends WalletRef {
  network_id: string;
  monitor_from_block: string | null;
  requested_backfill_from_block: string | null;
  asset_ids: string[];
}

export interface NearTickReport {
  networkId: string;
  scannedBlocks: number;
  skippedHeights?: number;
  transfers: number;
  fromHeight?: string;
  toHeight?: string;
}

export class NearChainIngestor {
  constructor(
    readonly networkId: string,
    private readonly workerId: string,
    private readonly maxBlocksPerTick = 10
  ) {
    if (!Number.isInteger(maxBlocksPerTick) || maxBlocksPerTick < 1 || maxBlocksPerTick > 100) {
      throw new Error("NEAR maxBlocksPerTick must be an integer from 1 to 100");
    }
  }

  async tick(): Promise<NearTickReport> {
    const config = loadNearNetworks().find((network) => network.id === this.networkId);
    if (!config?.enabled) throw new Error(`NEAR network ${this.networkId} is not enabled`);
    if (config.assets.length === 0) throw new Error(`NEAR network ${this.networkId} has no configured assets`);
    const data = new NearDataClient(config, { apiKey: process.env.FASTNEAR_API_KEY });
    const wallets = await this.loadWallets();
    if (!(await this.acquireLease(config.startHeight))) {
      return { networkId: config.id, scannedBlocks: 0, transfers: 0 };
    }

    let scannedBlocks = 0;
    let skippedHeights = 0;
    let transfers = 0;
    let fromHeight: bigint | undefined;
    let toHeight: bigint | undefined;
    try {
      const monitoredAccounts = new Set(wallets.map((wallet) => wallet.address));
      const tokenContracts = new Set(config.assets.map((asset) => asset.contractId));
      const assetsByContract = new Map(config.assets.map((asset) => [asset.contractId, asset]));
      const headReport = await data.getLatestFinalBlock(tokenContracts, monitoredAccounts);
      const head = headReport.block;
      let cursor = await this.readNextHeight(config.startHeight);
      const cursorBeforeBackfill = cursor.height;
      const requestedBackfill = this.earliestRequestedBackfill(wallets, config.startHeight);
      if (requestedBackfill !== null && requestedBackfill < cursor.height) {
        await this.rewindCursor(cursor.height, requestedBackfill);
        cursor = { height: requestedBackfill, blockHash: null };
      }
      const next = cursor.height;
      let previousHash = cursor.blockHash;
      // The network cursor is shared by every wallet. A backfill for one wallet can therefore
      // rewind it before another wallet was registered; keep each wallet's own monitoring start
      // as the authoritative lower bound so we do not attach older transfers to a new wallet.
      const walletStartBlocks = new Map(
        wallets.map((wallet) => {
          const requested = wallet.requested_backfill_from_block === null
            ? null
            : BigInt(wallet.requested_backfill_from_block) < config.startHeight
              ? config.startHeight
              : BigInt(wallet.requested_backfill_from_block);
          const start = wallet.monitor_from_block === null
            ? requested ?? cursorBeforeBackfill
            : BigInt(wallet.monitor_from_block);
          return [wallet.id, start] as const;
        })
      );
      fromHeight = next;
      if (!wallets.length) {
        // Stay at the finalized head before the first wallet is connected. The conditional update
        // prevents a wallet created during this tick from having its first block skipped.
        await this.fastForwardWithoutWallets(next, head.height + 1n, head.hash);
        return { networkId: config.id, scannedBlocks: 0, transfers: 0, fromHeight: next.toString(), toHeight: head.height.toString() };
      }
      await withSystem((client) =>
        client.query(
          `UPDATE wallets
              SET monitor_from_block = GREATEST(COALESCE(requested_backfill_from_block, $2::bigint), $3::bigint)
            WHERE network_id = $1 AND monitoring_enabled AND archived_at IS NULL AND monitor_from_block IS NULL`,
          [config.id, next.toString(), config.startHeight.toString()]
        )
      );
      let height = next;
      while (height <= head.height && scannedBlocks < this.maxBlocksPerTick) {
        let report: NearDataBlockReport;
        try {
          report = height === head.height
            ? headReport
            : await data.getFinalBlockByHeight(height, tokenContracts, monitoredAccounts);
        } catch (error) {
          if (!(error instanceof NearDataMissingBlockError)) throw error;
          // NEAR can skip a block height. Only advance when a later finalized block explicitly
          // names the last processed height/hash as its parent; an unavailable data slice cannot
          // be mistaken for an empty block.
          let successor: NearDataBlockReport | undefined;
          for (let candidate = height + 1n; candidate <= head.height && candidate <= height + 10n; candidate += 1n) {
            try {
              successor = candidate === head.height
                ? headReport
                : await data.getFinalBlockByHeight(candidate, tokenContracts, monitoredAccounts);
              break;
            } catch (candidateError) {
              if (!(candidateError instanceof NearDataMissingBlockError)) throw candidateError;
            }
          }
          if (!successor || successor.block.previousHeight !== height - 1n ||
              (previousHash !== null && successor.block.previousHash !== previousHash)) {
            throw new Error(`Cannot prove skipped NEAR height ${height}; cursor left unchanged`, { cause: error });
          }
          await this.saveProgress(successor.block.height, previousHash ?? successor.block.previousHash, height);
          skippedHeights += Number(successor.block.height - height);
          height = successor.block.height;
          continue;
        }
        const block = report.block;
        if (previousHash !== null && block.previousHash !== previousHash) {
          throw new Error(`NEAR block ${height} does not continue from the saved cursor hash`);
        }
        const millis = block.timestampNanoseconds / 1_000_000n;
        if (millis > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("NEAR block timestamp is out of range");
        const blockTimestamp = new Date(Number(millis));
        for (const event of report.transfers) {
          const wallet = wallets.find((candidate) => candidate.address === event.receiverAccountId);
          const asset = assetsByContract.get(event.tokenContractId);
          if (!wallet || !asset || !wallet.asset_ids.includes(asset.id)) continue;
          const walletStart = walletStartBlocks.get(wallet.id);
          if (walletStart !== undefined && block.height < walletStart) continue;
          const result = await withTenant(wallet.organization_id, (client) =>
            ingestObservation(
              client,
              wallet,
              {
                sourceType: "nep141_transfer",
                networkId: config.id,
                blockNumber: block.height,
                blockHash: event.blockHash,
                transactionHash: event.transactionHash,
                transactionIndex: 0,
                logIndex: event.logIndex,
                outcomeId: event.outcomeId,
                transferIndex: event.transferIndex,
                assetId: asset.id,
                tokenAddress: event.tokenContractId,
                fromAddress: event.senderAccountId,
                toAddress: event.receiverAccountId,
                amount: event.amount,
                blockTimestamp,
                raw: {
                  standard: "nep141",
                  event: "ft_transfer",
                  execution_kind: event.executionKind,
                  memo: event.memo ?? null,
                  event_log: event.eventLog
                }
              },
              "settled"
            )
          );
          if (result.created) transfers += 1;
        }

        scannedBlocks += 1;
        toHeight = height;
        await this.saveProgress(height + 1n, block.hash, height);
        previousHash = block.hash;
        height += 1n;
      }
      if (scannedBlocks > 0 || skippedHeights > 0) {
        log().info("near_ingestion_tick", {
          networkId: config.id,
          fromHeight: fromHeight?.toString(),
          toHeight: toHeight?.toString(),
          scannedBlocks,
          skippedHeights,
          transfers
        });
      }
      return {
        networkId: config.id,
        scannedBlocks,
        skippedHeights,
        transfers,
        ...(fromHeight === undefined ? {} : { fromHeight: fromHeight.toString() }),
        ...(toHeight === undefined ? {} : { toHeight: toHeight.toString() })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withSystem((client) =>
        client.query(
          `UPDATE network_cursors SET last_error = $3, last_error_at = now(), updated_at = now()
            WHERE network_id = $1 AND lease_owner = $2`,
          [this.networkId, this.workerId, message.slice(0, 1000)]
        )
      ).catch(() => undefined);
      throw error;
    } finally {
      await this.releaseLease();
    }
  }

  private async loadWallets(): Promise<NearWallet[]> {
    return withSystem(async (client) => {
      const rows = await client.query(
        `SELECT w.id, w.organization_id, w.environment, w.network_id, w.name, w.address,
                w.monitor_from_block, w.requested_backfill_from_block,
                array_agg(wa.asset_id ORDER BY wa.asset_id) AS asset_ids
           FROM wallets w JOIN wallet_assets wa ON wa.wallet_id = w.id
          WHERE w.network_id = $1 AND w.monitoring_enabled AND w.archived_at IS NULL
          GROUP BY w.id`,
        [this.networkId]
      );
      return rows.rows.map((row) => ({ ...row, asset_ids: row.asset_ids as string[] })) as NearWallet[];
    });
  }

  private async readNextHeight(startHeight: bigint): Promise<{ height: bigint; blockHash: string | null }> {
    return withSystem(async (client) => {
      await client.query(
        `INSERT INTO network_cursors (network_id, next_block_number)
         VALUES ($1,$2)
         ON CONFLICT (network_id) DO NOTHING`,
        [this.networkId, startHeight.toString()]
      );
      const cursor = await client.query<{ next_block_number: string; block_hash: string | null }>(
        "SELECT next_block_number, block_hash FROM network_cursors WHERE network_id = $1",
        [this.networkId]
      );
      if (!cursor.rows[0]) throw new Error(`Missing NEAR cursor for ${this.networkId}`);
      return { height: BigInt(cursor.rows[0].next_block_number), blockHash: cursor.rows[0].block_hash };
    });
  }

  private earliestRequestedBackfill(wallets: readonly NearWallet[], startHeight: bigint): bigint | null {
    const requested = wallets
      .map((wallet) => wallet.requested_backfill_from_block)
      .filter((value): value is string => value !== null)
      .map((value) => BigInt(value))
      .map((value) => value < startHeight ? startHeight : value);
    return requested.length ? requested.reduce((minimum, value) => value < minimum ? value : minimum) : null;
  }

  private async rewindCursor(expectedHeight: bigint, targetHeight: bigint): Promise<void> {
    await withSystem(async (client) => {
      const result = await client.query(
        `UPDATE network_cursors
            SET next_block_number = $3, block_hash = NULL, updated_at = now(),
                lease_expires_at = now() + interval '30 seconds', last_error = NULL, last_error_at = NULL
          WHERE network_id = $1 AND lease_owner = $2 AND next_block_number = $4`,
        [this.networkId, this.workerId, targetHeight.toString(), expectedHeight.toString()]
      );
      if (result.rowCount !== 1) throw new Error(`NEAR cursor lease lost or advanced concurrently for ${this.networkId}`);
    });
  }

  private async acquireLease(startHeight: bigint): Promise<boolean> {
    return withSystem(async (client) => {
      await client.query(
        `INSERT INTO network_cursors (network_id, next_block_number) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [this.networkId, startHeight.toString()]
      );
      const result = await client.query(
        `UPDATE network_cursors SET lease_owner = $2, lease_expires_at = now() + interval '30 seconds', updated_at = now()
          WHERE network_id = $1 AND (lease_owner IS NULL OR lease_owner = $2 OR lease_expires_at < now())
          RETURNING network_id`,
        [this.networkId, this.workerId]
      );
      return result.rowCount === 1;
    });
  }

  private async saveProgress(nextHeight: bigint, blockHash: string, expectedHeight: bigint): Promise<void> {
    await withSystem(async (client) => {
      const result = await client.query(
        `UPDATE network_cursors SET next_block_number = $3, block_hash = $4, updated_at = now(),
                lease_expires_at = now() + interval '30 seconds', last_error = NULL, last_error_at = NULL
          WHERE network_id = $1 AND lease_owner = $2 AND next_block_number = $5`,
        [this.networkId, this.workerId, nextHeight.toString(), blockHash, expectedHeight.toString()]
      );
      if (result.rowCount !== 1) throw new Error(`NEAR cursor lease lost or advanced concurrently for ${this.networkId}`);
      await client.query(
        `UPDATE wallets
            SET requested_backfill_from_block = NULL, updated_at = now()
          WHERE network_id = $1 AND requested_backfill_from_block IS NOT NULL AND requested_backfill_from_block < $2::bigint`,
        [this.networkId, nextHeight.toString()]
      );
    });
  }

  private async fastForwardWithoutWallets(currentHeight: bigint, nextHeight: bigint, blockHash: string): Promise<void> {
    await withSystem((client) =>
      client.query(
        `UPDATE network_cursors SET next_block_number = $3, block_hash = $4, updated_at = now(),
                lease_expires_at = now() + interval '30 seconds', last_error = NULL, last_error_at = NULL
          WHERE network_id = $1 AND lease_owner = $2 AND next_block_number = $5
            AND NOT EXISTS (
              SELECT 1 FROM wallets w
               WHERE w.network_id = $1 AND w.monitoring_enabled AND w.archived_at IS NULL
            )`,
        [this.networkId, this.workerId, nextHeight.toString(), blockHash, currentHeight.toString()]
      )
    );
  }

  private async releaseLease(): Promise<void> {
    await withSystem((client) =>
      client.query(
        "UPDATE network_cursors SET lease_owner = NULL, lease_expires_at = NULL WHERE network_id = $1 AND lease_owner = $2",
        [this.networkId, this.workerId]
      )
    );
  }
}

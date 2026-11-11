import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { appEnv, loadNearNetworks } from "@zetra/config";
import { closePools } from "@zetra/database";
import { NearChainIngestor, deliverDueWebhooks, log, processDuePayouts, runHousekeeping, runRecurringBills } from "@zetra/engine";

/**
 * Zetra worker: blockchain ingestion (one loop per enabled network), webhook delivery and
 * housekeeping. Long-running work never happens in the API's request lifecycle.
 *
 * Failure policy: any error pauses that loop with exponential backoff and retries. Cursors only
 * advance after a range is committed, so a crash or restart resumes exactly where it stopped.
 */

process.env.ZETRA_SERVICE ??= "zetra-worker";
const env = appEnv();
const workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
let stopping = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loop(name: string, intervalMs: number, fn: () => Promise<unknown>, wake?: (resume: () => void) => () => void) {
  let failures = 0;
  let wakeUp: (() => void) | null = null;
  const unsubscribe = wake?.(() => wakeUp?.());
  while (!stopping) {
    try {
      await fn();
      failures = 0;
    } catch (error) {
      failures += 1;
      log().error(`${name}_failed`, { error: (error as Error).message, failures });
    }
    // Keep chain ingestion responsive through short provider/database hiccups. A one-minute
    // exponential pause made a single failed poll look like a missing customer payment.
    const backoffCap = name.startsWith("ingestion_") ? 5_000 : 60_000;
    const delay = failures ? Math.min(backoffCap, intervalMs * 2 ** Math.min(failures, 6)) : intervalMs;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wakeUp = null;
  }
  unsubscribe?.();
}

const loops: Promise<void>[] = [];
const enabledNetworks = loadNearNetworks().filter((candidate) => candidate.enabled);
if (!enabledNetworks.length) log().warn("no_near_networks_enabled", {});

for (const network of enabledNetworks) {
  const ingestor = new NearChainIngestor(network.id, workerId);
  log().info("near_chain_ingestion_started", {
    networkId: network.id,
    startHeight: network.startHeight.toString(),
    assets: network.assets.map((asset) => asset.contractId)
  });
  loops.push(
    loop(`ingestion_${network.id}`, env.WORKER_POLL_MS, async () => {
      const report = await ingestor.tick();
      if (report.scannedBlocks || report.transfers) log().info("near_ingestion_report", { ...report });
    })
  );
}

loops.push(loop("webhook_delivery", 1000, () => deliverDueWebhooks()));
loops.push(loop("housekeeping", 60_000, () => runHousekeeping()));
loops.push(loop("recurring_bills", 10 * 60_000, () => runRecurringBills()));
loops.push(loop("near_payouts", 2_000, () => processDuePayouts()));

log().info("worker_started", {
  workerId,
  networks: enabledNetworks.map((network) => network.id)
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    log().info("worker_stopping", { signal });
    stopping = true;
    await Promise.race([Promise.all(loops), sleep(15_000)]);
    await closePools();
    process.exit(0);
  });
}

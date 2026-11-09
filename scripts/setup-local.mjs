import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

function value(source, key) {
  return source.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() ?? "";
}

async function finalTestnetHeight(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "zetra-local-setup", method: "block", params: { finality: "final" } }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`NEAR testnet RPC returned HTTP ${response.status}`);
  const body = await response.json();
  const height = body?.result?.header?.height;
  if (!Number.isSafeInteger(height) || height < 1) throw new Error("NEAR testnet RPC did not return a valid finalized height");
  return String(height);
}

async function ensureLocalEnv() {
  if (existsSync(envPath)) {
    const current = readFileSync(envPath, "utf8");
    if (value(current, "NEAR_TESTNET_ENABLED") !== "true" || !/^\d+$/.test(value(current, "NEAR_TESTNET_START_HEIGHT"))) {
      throw new Error("Existing .env must enable NEAR testnet and set NEAR_TESTNET_START_HEIGHT. It was left unchanged.");
    }
    console.log("Using the existing .env without changing it.");
    return;
  }

  let source = readFileSync(examplePath, "utf8");
  const rpcUrl = value(source, "NEAR_TESTNET_RPC_URL");
  console.log("Reading the latest finalized NEAR testnet height...");
  const height = await finalTestnetHeight(rpcUrl);
  source = source
    .replace(/^SESSION_SECRET=replace-with-random-session-secret$/m, `SESSION_SECRET=${randomBytes(48).toString("base64")}`)
    .replace(/^ENCRYPTION_KEY=replace-with-64-hex-characters$/m, `ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`)
    .replace(/^NEAR_TESTNET_ENABLED=false$/m, "NEAR_TESTNET_ENABLED=true")
    .replace(/^NEAR_TESTNET_START_HEIGHT=$/m, `NEAR_TESTNET_START_HEIGHT=${height}`);
  writeFileSync(envPath, source, { mode: 0o600, flag: "wx" });
  console.log(`Created .env and set NEAR testnet ingestion to finalized block ${height}.`);
}

try {
  await ensureLocalEnv();
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  run("npm", ["run", "db:reset"]);
  run("npm", ["run", "demo:seed"]);
  run("npm", ["run", "demo:verify"]);
  console.log("\nLocal setup complete.");
  console.log("Run: npm run dev");
  console.log("Open: http://localhost:3000/login");
  console.log("Email: demo@zetra.local");
  console.log("Password: Zetra-Demo-2026!");
} catch (error) {
  console.error(`\nLocal setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

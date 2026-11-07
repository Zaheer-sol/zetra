import { spawnSync } from "node:child_process";

const account = process.env.ZETRA_ATTESTATION_ACCOUNT?.trim().toLowerCase();
if (!account || !/^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account)) {
  console.error("Set ZETRA_ATTESTATION_ACCOUNT to the NEAR testnet account that will own the contract.");
  process.exit(1);
}
if (process.env.NEAR_TESTNET_PAYOUT_PRIVATE_KEY || process.env.NEAR_MAINNET_PAYOUT_PRIVATE_KEY) {
  console.error("Deployment does not accept payout private keys. Sign with the NEAR CLI keychain instead.");
  process.exit(1);
}

const build = spawnSync("npm", ["run", "contracts:build:near"], { stdio: "inherit", shell: process.platform === "win32" });
if (build.status !== 0) process.exit(build.status ?? 1);

const args = [
  "contract", "deploy", account,
  "use-file", "target/wasm32-unknown-unknown/release/zetra_books_attestation.wasm",
  "with-init-call", "new",
  "json-args", "{}",
  "prepaid-gas", "100 Tgas",
  "attached-deposit", "0 NEAR",
  "network-config", "testnet",
  "sign-with-keychain",
  "send"
];
console.log(`Deploying books-attestation to ${account} on NEAR testnet. The NEAR CLI will request confirmation.`);
const result = spawnSync("near", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);

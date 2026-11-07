export type NearNetworkId = "near:mainnet" | "near:testnet";
export type NearEnvironment = "live" | "test";

export interface NearNetworkConfig {
  id: NearNetworkId;
  environment: NearEnvironment;
  name: string;
  rpcUrl: string;
  dataUrl: string;
  explorerUrl: string;
  finality: "final";
  enabled: boolean;
  startHeight: bigint;
  assets: NearAssetConfig[];
}

export interface NearAssetConfig {
  id: string;
  symbol: "USDC";
  name: string;
  contractId: string;
  decimals: 6;
  pegCurrency: "USD";
}

type Env = Record<string, string | undefined>;

function enabled(value: string | undefined, name: string): boolean {
  if (value === undefined || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean value`);
}

function rpcUrl(value: string | undefined, fallback: string, name: string): string {
  const url = new URL(value?.trim() || fallback);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`${name} must use HTTPS unless it points to localhost`);
  }
  return url.toString().replace(/\/$/, "");
}

function accountId(value: string | undefined, name: string): string | undefined {
  const id = value?.trim().toLowerCase();
  if (!id) return undefined;
  if (
    id.length < 2 ||
    id.length > 64 ||
    !/^[a-z0-9._-]+$/.test(id) ||
    !/[a-z0-9]$/.test(id) ||
    /[._-]{2}/.test(id)
  ) {
    throw new Error(`${name} must be a valid NEAR account ID`);
  }
  return id;
}

function startHeight(value: string | undefined, isEnabled: boolean, name: string): bigint {
  if (value === undefined || value.trim() === "") {
    if (isEnabled) throw new Error(`${name} is required when the NEAR network is enabled`);
    return 0n;
  }
  if (!/^(0|[1-9]\d*)$/.test(value.trim())) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(value.trim());
}

function assets(contractId: string | undefined, network: NearNetworkId, isEnabled: boolean): NearAssetConfig[] {
  const normalized = accountId(contractId, `${network === "near:mainnet" ? "NEAR_MAINNET" : "NEAR_TESTNET"}_USDC_CONTRACT_ID`);
  if (!normalized && isEnabled) {
    throw new Error(`${network === "near:mainnet" ? "NEAR_MAINNET" : "NEAR_TESTNET"}_USDC_CONTRACT_ID is required when the NEAR network is enabled`);
  }
  return normalized
    ? [{
        id: `${network.replace(":", "_")}_usdc`,
        symbol: "USDC",
        name: "USD Coin",
        contractId: normalized,
        decimals: 6,
        pegCurrency: "USD"
      }]
    : [];
}

/**
 * NEAR network identity is a stable string.
 * Networks stay disabled until a token contract account ID and scan start are configured.
 */
export function loadNearNetworks(env: Env = process.env): NearNetworkConfig[] {
  const mainnetEnabled = enabled(env.NEAR_MAINNET_ENABLED, "NEAR_MAINNET_ENABLED");
  const testnetEnabled = enabled(env.NEAR_TESTNET_ENABLED, "NEAR_TESTNET_ENABLED");
  return [
    {
      id: "near:mainnet",
      environment: "live",
      name: "NEAR Mainnet",
      rpcUrl: rpcUrl(env.NEAR_MAINNET_RPC_URL, "https://rpc.mainnet.near.org", "NEAR_MAINNET_RPC_URL"),
      dataUrl: rpcUrl(env.NEAR_MAINNET_DATA_URL, "https://mainnet.neardata.xyz", "NEAR_MAINNET_DATA_URL"),
      explorerUrl: "https://nearblocks.io",
      finality: "final",
      enabled: mainnetEnabled,
      startHeight: startHeight(env.NEAR_MAINNET_START_HEIGHT, mainnetEnabled, "NEAR_MAINNET_START_HEIGHT"),
      assets: assets(env.NEAR_MAINNET_USDC_CONTRACT_ID, "near:mainnet", mainnetEnabled)
    },
    {
      id: "near:testnet",
      environment: "test",
      name: "NEAR Testnet",
      rpcUrl: rpcUrl(env.NEAR_TESTNET_RPC_URL, "https://test.rpc.fastnear.com", "NEAR_TESTNET_RPC_URL"),
      dataUrl: rpcUrl(env.NEAR_TESTNET_DATA_URL, "https://testnet.neardata.xyz", "NEAR_TESTNET_DATA_URL"),
      explorerUrl: "https://testnet.nearblocks.io",
      finality: "final",
      enabled: testnetEnabled,
      startHeight: startHeight(env.NEAR_TESTNET_START_HEIGHT, testnetEnabled, "NEAR_TESTNET_START_HEIGHT"),
      assets: assets(env.NEAR_TESTNET_USDC_CONTRACT_ID, "near:testnet", testnetEnabled)
    }
  ];
}

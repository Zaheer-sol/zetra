import { describe, expect, it } from "vitest";
import { loadNearNetworks } from "./near-networks";

describe("loadNearNetworks", () => {
  it("uses stable string IDs, canonical RPC defaults, and keeps both networks disabled", () => {
    expect(loadNearNetworks({})).toEqual([
      {
        id: "near:mainnet",
        environment: "live",
        name: "NEAR Mainnet",
        rpcUrl: "https://rpc.mainnet.near.org",
        dataUrl: "https://mainnet.neardata.xyz",
        explorerUrl: "https://nearblocks.io",
        finality: "final",
        enabled: false,
        startHeight: 0n,
        assets: []
      },
      {
        id: "near:testnet",
        environment: "test",
        name: "NEAR Testnet",
        rpcUrl: "https://test.rpc.fastnear.com",
        dataUrl: "https://testnet.neardata.xyz",
        explorerUrl: "https://testnet.nearblocks.io",
        finality: "final",
        enabled: false,
        startHeight: 0n,
        assets: []
      }
    ]);
  });

  it("allows explicit endpoint and enablement configuration", () => {
    const [mainnet, testnet] = loadNearNetworks({
      NEAR_MAINNET_RPC_URL: "https://rpc.example.org/",
      NEAR_MAINNET_DATA_URL: "https://data.example.org/",
      NEAR_MAINNET_ENABLED: "true",
      NEAR_MAINNET_START_HEIGHT: "12345",
      NEAR_MAINNET_USDC_CONTRACT_ID: "usdc.token.near",
      NEAR_TESTNET_ENABLED: "0"
    });
    expect(mainnet).toMatchObject({
      rpcUrl: "https://rpc.example.org",
      dataUrl: "https://data.example.org",
      enabled: true,
      startHeight: 12345n,
      assets: [{ contractId: "usdc.token.near", decimals: 6 }]
    });
    expect(testnet).toMatchObject({ enabled: false, assets: [] });
  });

  it("rejects malformed or insecure endpoints and invalid boolean values", () => {
    expect(() => loadNearNetworks({ NEAR_TESTNET_RPC_URL: "http://rpc.example.org" })).toThrow(/HTTPS/);
    expect(() => loadNearNetworks({ NEAR_TESTNET_DATA_URL: "http://data.example.org" })).toThrow(/HTTPS/);
    expect(() => loadNearNetworks({ NEAR_TESTNET_RPC_URL: "not a URL" })).toThrow();
    expect(() => loadNearNetworks({ NEAR_TESTNET_ENABLED: "sometimes" })).toThrow(/boolean/);
    expect(() => loadNearNetworks({ NEAR_TESTNET_ENABLED: "true" })).toThrow(/NEAR_TESTNET_START_HEIGHT/);
    expect(() => loadNearNetworks({
      NEAR_TESTNET_ENABLED: "true",
      NEAR_TESTNET_START_HEIGHT: "1",
      NEAR_TESTNET_USDC_CONTRACT_ID: "NOT AN ACCOUNT"
    })).toThrow(/account ID/);
  });
});

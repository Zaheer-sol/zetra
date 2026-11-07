import { loadNearNetworks, type NearEnvironment } from "./near-networks";

export type Environment = NearEnvironment;

export interface PaymentAssetConfig {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  contractId: string;
  pegCurrency: string;
}

export interface PaymentNetworkConfig {
  id: string;
  family: string;
  environment: Environment;
  name: string;
  enabled: boolean;
  explorerUrl?: string;
  rpcUrl: string;
  nativeSymbol: string;
  assets: PaymentAssetConfig[];
}

/** Resolve a merchant-facing family name or stable NEAR network identity. */
export function resolvePaymentNetwork(key: string, environment: Environment): PaymentNetworkConfig | undefined {
  const near = loadNearNetworks().find((network) => network.id === key && network.environment === environment);
  if (near) {
    return {
      id: near.id,
      family: "near",
      environment: near.environment,
      name: near.name,
      enabled: near.enabled,
      explorerUrl: near.explorerUrl,
      rpcUrl: near.rpcUrl,
      nativeSymbol: "NEAR",
      assets: near.assets.map((asset) => ({
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        decimals: asset.decimals,
        contractId: asset.contractId,
        pegCurrency: asset.pegCurrency
      }))
    };
  }

  return undefined;
}

export function paymentNetworkById(id: string): PaymentNetworkConfig | undefined {
  if (id.startsWith("near:")) {
    const network = loadNearNetworks().find((candidate) => candidate.id === id);
    return network ? resolvePaymentNetwork(network.id, network.environment) : undefined;
  }
  return undefined;
}

/** Find a configured NEP-141 asset. */
export function paymentAssetById(assetId: string): { network: PaymentNetworkConfig; asset: PaymentAssetConfig } | undefined {
  for (const network of loadNearNetworks()) {
    const asset = network.assets.find((candidate) => candidate.id === assetId);
    if (asset) {
      const paymentNetwork = resolvePaymentNetwork(network.id, network.environment);
      if (paymentNetwork) return { network: paymentNetwork, asset: paymentNetwork.assets.find((candidate) => candidate.id === assetId)! };
    }
  }
  return undefined;
}

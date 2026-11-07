/**
 * Preparation boundary for a future NEAR Intents / 1Click connector.
 *
 * This is intentionally only a typed settlement-proof contract. No live routing or quote
 * generation is claimed here: the normal engine must receive a verifiable NEAR transaction and
 * finalized transfer evidence before it can create a payment or accounting entry.
 */
export interface NearIntentsSettlementProof {
  provider: "near-intents-1click";
  intent_id: string;
  settlement_network: "near:mainnet" | "near:testnet";
  transaction_hash: string;
  block_hash: string;
  block_height: string;
  token_contract: string;
  sender: string;
  receiver: string;
  amount: string;
  memo?: string | null;
  finalized: true;
  synthetic_fixture?: boolean;
}

export interface NearIntentsSettlementAdapter {
  readonly provider: "near-intents-1click";
  normalizeSettlementProof(input: unknown): NearIntentsSettlementProof | null;
}

export const NEAR_INTENTS_ADAPTER_STATUS = "interface-only; live routing is not integrated" as const;

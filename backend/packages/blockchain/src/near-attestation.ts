import { connect, keyStores, KeyPair, transactions } from "near-api-js";
import { loadNearNetworks, type NearNetworkId } from "@zetra/config";

export interface NearAttestationInput {
  networkId: NearNetworkId;
  contractId: string;
  signerId: string;
  privateKey: string;
  bookId: string;
  period: number;
  root: string;
  entryCount: number;
}

export interface NearAttestationResult {
  transactionHash: string;
  blockHash: string | null;
  explorerUrl: string;
  raw: unknown;
}

const ATTESTATION_STORAGE_DEPOSIT = 10n ** 23n; // 0.1 NEAR; unused storage is refunded by the contract.

export async function attestBooks(input: NearAttestationInput): Promise<NearAttestationResult> {
  const network = loadNearNetworks().find((candidate) => candidate.id === input.networkId);
  if (!network || !network.enabled) throw new Error(`NEAR network ${input.networkId} is not enabled for this deployment`);
  if (!input.privateKey.startsWith("ed25519:")) throw new Error("NEAR attestation signer key must be an ed25519 key");
  if (!/^0x[0-9a-f]{64}$/.test(input.root)) throw new Error("Attestation root must be a 32-byte hexadecimal hash");
  if (!Number.isInteger(input.period) || input.period < 200001 || input.period > 999912) throw new Error("Attestation period must be YYYYMM");
  const store = new keyStores.InMemoryKeyStore();
  const networkId = network.environment === "live" ? "mainnet" : "testnet";
  await store.setKey(networkId, input.signerId, KeyPair.fromString(input.privateKey as never));
  const near = await connect({ networkId, nodeUrl: network.rpcUrl, deps: { keyStore: store } });
  const account = await near.account(input.signerId);
  // The legacy Account#functionCall helper uses EXECUTED_OPTIMISTIC. A books attestation is only
  // publishable after the contract receipt is final, so use the explicit FINAL transaction API.
  const outcome = await account.signAndSendTransaction({
    receiverId: input.contractId,
    actions: [transactions.functionCall(
      "attest",
      { book_id: input.bookId, period: input.period, root: input.root, entry_count: input.entryCount },
      100n * 10n ** 12n,
      ATTESTATION_STORAGE_DEPOSIT
    )],
    waitUntil: "FINAL"
  });
  const raw = outcome as unknown as Record<string, any>;
  const tx = raw.transaction ?? {};
  const txHash = typeof tx.hash === "string" ? tx.hash : null;
  if (!txHash) throw new Error("NEAR RPC did not return a transaction hash for the attestation");
  const blockHash = typeof tx.block_hash === "string" ? tx.block_hash : typeof raw.transaction_outcome?.outcome?.block_hash === "string" ? raw.transaction_outcome.outcome.block_hash : null;
  return { transactionHash: txHash, blockHash, explorerUrl: `${network.explorerUrl}/txns/${txHash}`, raw: outcome };
}

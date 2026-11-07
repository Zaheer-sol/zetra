import type { FastifyInstance } from "fastify";
import { attestBooks } from "@zetra/blockchain";
import { audit, createClosePackage, listClosePackages, previewClosePackage, serializeClosePackage, sha256Canonical, verifyClosePackage } from "@zetra/engine";
import { z } from "zod";
import { ApiError } from "../../lib/errors";
import { idParam, route } from "../../lib/route";

const month = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const verifyBody = z.object({ artifact: z.unknown().optional() }).default({});

export function closePackageRoutes(app: FastifyInstance) {
  route(app, {
    method: "GET",
    url: "/v1/accounting/close-packages/preview",
    summary: "Preview the deterministic Proof-of-Close artifact and hash for a period",
    tags: ["accounting"],
    permission: "financials:read",
    query: month,
    handler: ({ tx, query, organizationId, environment }) => tx(async (c) => {
      const preview = await previewClosePackage(c, organizationId, environment, query.month);
      return { object: "close_package_preview", period: query.month, canonical_hash: `0x${preview.hash}`, blocking_checks: preview.blocking, artifact_metadata: preview.metadata, artifact: preview.artifact };
    })
  });

  route(app, {
    method: "POST",
    url: "/v1/accounting/close-packages",
    summary: "Create a deterministic Proof-of-Close package for a closed period",
    tags: ["accounting"],
    permission: "financials:manage",
    sessionOnly: true,
    body: month,
    handler: ({ tx, body, organizationId, environment, actor, reply }) => tx(async (c) => {
      const result = await createClosePackage(c, organizationId, environment, body.month, actor);
      reply.code(201);
      return result;
    })
  });

  route(app, {
    method: "GET",
    url: "/v1/accounting/close-packages",
    summary: "List Proof-of-Close packages",
    tags: ["accounting"],
    permission: "financials:read",
    handler: ({ tx, organizationId, environment }) => tx((c) => listClosePackages(c, organizationId, environment))
  });

  route(app, {
    method: "POST",
    url: "/v1/accounting/close-packages/:id/verify",
    summary: "Verify a stored or exported Proof-of-Close artifact against its hash",
    tags: ["accounting"],
    permission: "financials:read",
    params: idParam,
    body: verifyBody,
    handler: ({ tx, params, body, organizationId, environment }) => tx(async (c) => {
      if (body.artifact !== undefined) {
        const row = (await c.query("SELECT id, canonical_hash, artifact_metadata FROM close_packages WHERE id = $1 AND organization_id = $2 AND environment = $3", [params.id, organizationId, environment])).rows[0];
        if (!row) throw new ApiError(404, "close_package_not_found", "No such close package.");
        const computed = `0x${sha256Canonical(body.artifact)}`;
        return { id: params.id, verified: computed === row.canonical_hash, stored_hash: row.canonical_hash, computed_hash: computed, artifact_metadata: row.artifact_metadata };
      }
      return verifyClosePackage(c, organizationId, environment, params.id);
    })
  });

  route(app, {
    method: "POST",
    url: "/v1/accounting/close-packages/:id/attest",
    summary: "Publish a Proof-of-Close hash through the optional NEAR attestation contract",
    tags: ["accounting"],
    permission: "financials:manage",
    sessionOnly: true,
    params: idParam,
    handler: async ({ params, tx, organizationId, environment, actor }) => {
      const row = await tx(async (c) => (await c.query("SELECT * FROM close_packages WHERE id = $1 AND organization_id = $2 AND environment = $3", [params.id, organizationId, environment])).rows[0]);
      if (!row) throw new ApiError(404, "close_package_not_found", "No such close package.");
      if (row.status === "attested") return serializeClosePackage(row);
      const networkId = environment === "live" ? "near:mainnet" : "near:testnet";
      const contractId = process.env.ZETRA_ATTESTATION_CONTRACT_ID?.trim().toLowerCase();
      const signerId = process.env.ZETRA_ATTESTATION_SIGNER_ID?.trim().toLowerCase();
      const privateKey = process.env.ZETRA_ATTESTATION_PRIVATE_KEY?.trim();
      if (!contractId || !signerId || !privateKey) throw new ApiError(409, "attestation_not_configured", "Proof prepared but not attested: configure the NEAR attestation contract and signer for this deployment.");
      const result = await attestBooks({ networkId, contractId, signerId, privateKey, bookId: `${organizationId}:${environment}`, period: Number(String(row.period_start).slice(0, 7).replace("-", "")), root: row.canonical_hash, entryCount: Number(row.artifact_metadata?.journal_entry_count ?? 0) });
      return tx(async (c) => {
        const updated = (await c.query("UPDATE close_packages SET status='attested', near_network=$2, contract_account=$3, transaction_hash=$4, block_hash=$5, explorer_url=$6, updated_at=now() WHERE id=$1 AND organization_id=$7 RETURNING *", [params.id, networkId, contractId, result.transactionHash, result.blockHash, result.explorerUrl, organizationId])).rows[0];
        await audit(c, actor, { organizationId, environment, action: "close_package_attested", objectType: "close_package", objectId: params.id, next: { transaction_hash: result.transactionHash, block_hash: result.blockHash } });
        return serializeClosePackage(updated);
      });
    }
  });
}

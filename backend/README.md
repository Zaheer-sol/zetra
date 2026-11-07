# Backend

`src/` is the Fastify API, `worker/` runs ingestion and delivery loops, and `packages/` contains
shared configuration, database, blockchain, matching, event, and SDK workspaces.

From the repository root:

```bash
npm run dev:api
npm run dev:worker
npm run typecheck
npm test
```

The API and worker share the same engine, database, schemas, and network registry. Chain adapters live
in `packages/blockchain`; network definitions live in `packages/config`.

Set local configuration in the repository root `.env`; see [`.env.example`](../.env.example). See
[the architecture guide](../docs/architecture.md), [NEAR integration notes](../docs/near.md), and
the [verification checklist](../docs/verification.md).

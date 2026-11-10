# Railway deployment

Zetra uses one public Next.js web service, a private Fastify API, a private background worker, and
PostgreSQL. Deploy each code service from the same GitHub repository. The repository includes a
service-specific Dockerfile for each process because the root Dockerfile's final stage is the web
image.

## Services and build settings

Create or configure these Railway services in the same project and environment:

| Service | Dockerfile path | Runtime |
| --- | --- | --- |
| `zetra-web` | `Dockerfile.web` | Public HTTP on port `3000` |
| `zetra-api` | `Dockerfile.api` | Private HTTP on port `4000` |
| `zetra-worker` | `Dockerfile.worker` | Private worker; no public domain |
| `Postgres` | Railway PostgreSQL | Private database |

For each code service, set `RAILWAY_DOCKERFILE_PATH` to the path in the table. Railway should build
from the repository root so npm workspaces and shared packages remain available. Give the web
service a public domain; keep the API and worker private. Railway detects and uses Dockerfiles in a
repository, and the service-specific Dockerfile setting selects the right process image.

Set the API pre-deploy command to:

```sh
node dist/migrate.js
```

This runs as the database owner before the API starts. The migration provisions the restricted
`zetra_app` role using `APP_DB_PASSWORD`; API and worker runtime connections then use that restricted
role. Configure the API health check as `/v1/health/live` if you enable Railway health checks.

## Variables

Use Railway reference variables for service connections. Do not paste database URLs or secrets into
the repository.

### API service

```text
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=4000
PORT=4000
DATABASE_URL=${{Postgres.DATABASE_URL}}
MIGRATION_DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_DB_PASSWORD=<strong random password>
SESSION_SECRET=<at least 32 random characters>
ENCRYPTION_KEY=<32 random bytes encoded as 64 hex characters>
WEB_ORIGIN=https://${{zetra-web.RAILWAY_PUBLIC_DOMAIN}}
PUBLIC_APP_URL=https://${{zetra-web.RAILWAY_PUBLIC_DOMAIN}}
NEAR_TESTNET_ENABLED=true
NEAR_TESTNET_START_HEIGHT=<recent finalized NEAR testnet block height>
NEAR_TESTNET_USDC_CONTRACT_ID=usdc.fakes.testnet
WEBHOOK_ALLOW_PRIVATE_URLS=false
```

Set `NEAR_TESTNET_START_HEIGHT` to a recent finalized block height, not zero. This enables only the
configured testnet token; it has no real-world value.

### Worker service

```text
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_DB_PASSWORD=<same value as the API service>
NEAR_TESTNET_ENABLED=true
NEAR_TESTNET_START_HEIGHT=<same value as the API service>
NEAR_TESTNET_USDC_CONTRACT_ID=usdc.fakes.testnet
```

### Web service

```text
NEXT_PUBLIC_APP_URL=https://${{zetra-web.RAILWAY_PUBLIC_DOMAIN}}
API_INTERNAL_URL=http://${{zetra-api.RAILWAY_PRIVATE_DOMAIN}}:4000
API_INTERNAL_PROTOCOL=http
PORT=3000
```

The web Dockerfile passes `NEXT_PUBLIC_APP_URL` to Next.js during the build for canonical and social
metadata. After generating the web service domain, set these references and redeploy the affected
services so the URLs resolve correctly.

## Setup and rollout

1. Connect the repository to Railway and create the PostgreSQL service.
2. Create the web, API, and worker services from the repository root, using the Dockerfile paths
   above. Do not use a package subdirectory as the root; the services share npm workspace packages.
3. Add the variables above. Generate secrets with a password manager or a cryptographic random
   generator; never commit them.
4. Configure the API pre-deploy migration command, then deploy API and worker. Deploy the web service
   and generate its public domain.
5. Add the public domain references, redeploy the web and API services, and sign up through the
   hosted site. Local demo credentials from `npm run setup:local` are not production credentials.
6. Confirm `/v1/health/live` on the API and complete a real testnet wallet payment before claiming
   that production testnet reconciliation works. A test-mode simulation is not an on-chain payment.

Railway service settings and environment variables are account-specific, so this guide does not
claim that services have been provisioned or that a payment has happened. Railway's current docs:
[Dockerfiles](https://docs.railway.com/builds/dockerfiles),
[private networking](https://docs.railway.com/networking/domains/working-with-domains), and
[variables](https://docs.railway.com/variables).

# Render deployment

The root `render.yaml` defines the production services:

- `zetra-web`: Next.js app exposed publicly on port 10000.
- `zetra-api`: private Fastify API on port 4000. The web app proxies browser requests to it over
  Render's private network.
- `zetra-worker`: private background service for NEAR ingestion, scheduled payouts, recurring bills,
  and webhook delivery.
- `zetra-postgres`: PostgreSQL database.

## Deploy

1. Push this repository to GitHub and connect it to Render as a Blueprint.
2. Choose **Apply** for the Blueprint. Render generates `SESSION_SECRET`, `ENCRYPTION_KEY`, and
   `APP_DB_PASSWORD` in the shared secret group.
3. When prompted for `NEAR_TESTNET_START_HEIGHT`, enter a recent finalized NEAR testnet block
   height. Do not use zero; that would ask the worker to scan from genesis.
4. Wait for the API pre-deploy command to apply database migrations. The migrator provisions the
   restricted `zetra_app` role before migrations grant it permissions. API and worker connections
   use this role, not the Render database owner, so PostgreSQL row-level security remains active.
5. Open the `zetra-web` URL and create a workspace. Use a separate NEAR testnet wallet to claim the
   configured test token and submit a real testnet transfer from the hosted checkout.
6. Confirm the transfer is finalized and reconciled in the console. A simulated payment is not a
   substitute for this check.

The Blueprint enables only NEAR testnet and configures `usdc.fakes.testnet`, a test token with no
real-world value. It does not enable mainnet, fund wallets, submit a blockchain transaction, deploy
the attestation contract, or configure optional SMTP/Stripe credentials. Keep payout and attestation
signer keys out of the repository and add them only to the relevant Render service if you explicitly
enable those operations.

## Notes

- `npm run db:migrate` runs as the database owner in the API pre-deploy step. The runtime API and
  worker derive a `zetra_app` connection from the Render database URL and `APP_DB_PASSWORD`.
- The application should run as one API instance initially because its rate limiter is process-local.
- A paid Render plan is required for the configured pre-deploy migration command. Review the current
  Render plan and database costs before applying the Blueprint.
- Password reset and invitation email delivery require production SMTP settings. Configure
  `SMTP_URL` and `EMAIL_FROM` in the API service if email delivery is needed.

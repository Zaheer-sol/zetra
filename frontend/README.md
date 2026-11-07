# Zetra frontend

The Next.js application contains the marketing site, product documentation, authenticated console,
and hosted payment page.

From the repository root:

```bash
npm run dev:web
npm run build -w @zetra/web
npm run typecheck -w @zetra/web
```

The frontend talks to the API through the same-origin `/api/*` route. Set `API_INTERNAL_URL` when the
API is hosted separately. Frontend-specific setup and shared repository commands are documented in
the root [README](../README.md). Wallet checkout and chain display use the configured networks
returned by the API. The hosted payment page includes a native NEAR wallet flow: it connects a
NEAR wallet and submits the configured token transfer and invoice memo. NEAR networks, token
contracts, RPC endpoints, and scan start heights must be configured by the server; NEAR is not
assumed to be available by default. Follow the repository verification checklist before enabling a
network.

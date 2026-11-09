# Books-attestation deployment

Zetra includes a small Rust contract that publishes a merchant's monthly books root. The
application can prepare and verify a root locally; the contract is optional to payment processing.

The repository contains deployment automation, but it deliberately does not contain a key.

## Current testnet deployment

- Contract account: `zetra-books-electron.testnet`
- Deployment transaction: [`FVxHsUkb8VJuGDC6xn82cXCw4MDCVbWzuEi3WHCREwwS`](https://explorer.testnet.near.org/transactions/FVxHsUkb8VJuGDC6xn82cXCw4MDCVbWzuEi3WHCREwwS)
- The testnet RPC confirms contract code is installed. No books attestation has yet been published.
- The contract has not been externally audited.

## Testnet deployment

1. Install and authenticate the current [NEAR CLI](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md).
2. Ensure the account has testnet NEAR for storage and gas.
3. Run:

```sh
ZETRA_ATTESTATION_ACCOUNT=books-attestation.yourname.testnet npm run contracts:deploy:near
```

The script builds `zetra_books_attestation.wasm`, then invokes the NEAR CLI with `sign-with-keychain`
and the testnet network. It never reads or accepts a private key from the project.

After deployment, record the account and transaction from the CLI output in your release notes and
set the contract account in the deployment's secret/configuration manager. To enable the API's
optional attestation action, configure the contract and a dedicated signer separately:

```sh
ZETRA_ATTESTATION_CONTRACT_ID=books-attestation.yourname.testnet
ZETRA_ATTESTATION_SIGNER_ID=books-attestation.yourname.testnet
ZETRA_ATTESTATION_PRIVATE_KEY=ed25519:...
```

The private key is read only from the runtime secret boundary and is never persisted in Zetra.
If these values are absent, the UI remains in a clear “prepared but not attested” state. An
external security audit is still required before using the contract for production attestations.

## Contract checks

```sh
npm run test:contracts:near
npm run contracts:build:near
```

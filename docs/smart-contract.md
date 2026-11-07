# NEAR contract

Zetra currently uses one native NEAR contract: `contracts/near/books-attestation`.

It publishes a merchant-controlled attestation hash and timestamp. The payment product does not
require a contract: it monitors final NEP-141 transfers directly and matches them using each
invoice's NEAR payment memo.

```sh
npm run test:contracts:near
npm run contracts:build:near
```

Deployment automation is available through `npm run contracts:deploy:near` with
`ZETRA_ATTESTATION_ACCOUNT=...`. It uses the NEAR CLI keychain and never takes a private key from
the repository. A deployment and independent audit remain operator responsibilities.

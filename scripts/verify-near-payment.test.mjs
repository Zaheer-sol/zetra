import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, parsePaymentUrl, verifyNearPayment } from "./verify-near-payment.mjs";

const HASH = "3Z8iGU4sAhd5y9Yib8jYsXfbPWrRfG3a2WyzxVNfLFXp";
const PAYMENT_URL = "https://zetra.example/pay/abcdefghijklmnop";

test("parses a hosted Zetra payment URL without retaining its query string", () => {
  assert.deepEqual(parsePaymentUrl(`${PAYMENT_URL}?utm_source=demo#payment`), {
    origin: "https://zetra.example",
    token: "abcdefghijklmnop"
  });
});

test("rejects insecure non-local HTTP and URLs outside hosted payment pages", () => {
  assert.throws(() => parsePaymentUrl("http://zetra.example/pay/abcdefghijklmnop"), /HTTPS/);
  assert.throws(() => parsePaymentUrl("https://zetra.example/app"), /\/pay\//);
  assert.throws(() => parsePaymentUrl("https://user:secret@zetra.example/pay/abcdefghijklmnop"), /credentials/);
});

test("requires payer identity and a valid NEAR transaction hash", () => {
  assert.throws(() => parseArgs(["--payment-url", PAYMENT_URL, "--payer", "bad id", "--tx", HASH]), /account ID/);
  assert.throws(() => parseArgs(["--payment-url", PAYMENT_URL, "--payer", "payer.testnet", "--tx", "not-a-hash"]), /transaction hash/);
});

test("submits only verification data and reports review without claiming invoice application", async () => {
  let request;
  const proof = await verifyNearPayment({
    paymentUrl: PAYMENT_URL,
    payer: "payer.testnet",
    transactionHash: HASH,
    fetcher: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({
        state: "overpaid",
        pay: { network: { id: "near:testnet" }, asset: { address: "usdc.testnet" }, recipient: "merchant.testnet" },
        payments: [{ amount: "20.00", status: "needs_review", transaction_hash: HASH, explorer_url: "https://testnet.nearblocks.io/txns/example", simulated: false }],
        verification: { recorded: true, transaction_hash: HASH, invoice_state: "overpaid", payment_statuses: ["needs_review"] }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.equal(request.url, "https://zetra.example/api/v1/public/payment-requests/abcdefghijklmnop/verify");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), { payer_account_id: "payer.testnet", transaction_hash: HASH });
  assert.equal(proof.result, "finalized_near_transfer_recorded");
  assert.equal(proof.payer_account_id, "payer.testnet");
  assert.equal(proof.recipient_account_id, "merchant.testnet");
  assert.equal(proof.token_contract, "usdc.testnet");
  assert.equal(proof.disposition, "held_for_review");
  assert.equal(proof.evidence[0].status, "needs_review");
});

test("preserves the exact accounting disposition in verification output", async () => {
  const cases = [
    ["matched", "applied_to_invoice"],
    ["partial", "partially_applied"],
    ["overpaid", "overpaid_recorded"],
    ["unmatched", "recorded_for_accounting_review"]
  ];
  for (const [status, expected] of cases) {
    const proof = await verifyNearPayment({
      paymentUrl: PAYMENT_URL,
      payer: "payer.testnet",
      transactionHash: HASH,
      fetcher: async () => new Response(JSON.stringify({
        payments: [{ amount: "5.00", status, transaction_hash: HASH, simulated: false }],
        verification: { recorded: true, transaction_hash: HASH, invoice_state: status, payment_statuses: [status] }
      }), { status: 200, headers: { "content-type": "application/json" } })
    });
    assert.equal(proof.disposition, expected, `status ${status}`);
  }
});

test("does not return proof when the API says the payment was not recorded", async () => {
  await assert.rejects(verifyNearPayment({
    paymentUrl: PAYMENT_URL,
    payer: "payer.testnet",
    transactionHash: HASH,
    fetcher: async () => new Response(JSON.stringify({ verification: { recorded: false, transaction_hash: HASH } }), { status: 200 })
  }), /did not confirm/);
});

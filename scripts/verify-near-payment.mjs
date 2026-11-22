#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const ACCOUNT_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const TRANSACTION_HASH = /^[1-9A-HJ-NP-Za-km-z]{40,50}$/;
const PAYMENT_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export function parsePaymentUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--payment-url must be a complete hosted payment page URL.");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Use an HTTPS payment page URL (HTTP is allowed only for localhost).");
  }
  if (url.username || url.password) throw new Error("The payment URL must not contain credentials.");
  const match = url.pathname.match(/^\/pay\/([A-Za-z0-9_-]{16,64})\/?$/);
  if (!match || !PAYMENT_TOKEN.test(match[1])) {
    throw new Error("--payment-url must point to a Zetra hosted page in the form /pay/<token>.");
  }
  return { origin: url.origin, token: match[1] };
}

export function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") return { help: true };
    if (!["--payment-url", "--payer", "--tx"].includes(key)) {
      throw new Error(`Unknown option: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value.`);
    if (values.has(key)) throw new Error(`${key} may be supplied only once.`);
    values.set(key, value);
    index += 1;
  }

  const paymentUrl = values.get("--payment-url");
  const payer = values.get("--payer");
  const transactionHash = values.get("--tx");
  if (!paymentUrl || !payer || !transactionHash) {
    throw new Error("Provide --payment-url, --payer and --tx. Use --help for usage.");
  }
  if (!ACCOUNT_ID.test(payer)) throw new Error("--payer must be a NEAR account ID.");
  if (!TRANSACTION_HASH.test(transactionHash)) throw new Error("--tx must be a NEAR transaction hash.");
  return { help: false, paymentUrl, payer, transactionHash };
}

export async function verifyNearPayment({ paymentUrl, payer, transactionHash, fetcher = fetch }) {
  const { origin, token } = parsePaymentUrl(paymentUrl);
  const endpoint = new URL(`/api/v1/public/payment-requests/${encodeURIComponent(token)}/verify`, origin);
  let response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ payer_account_id: payer, transaction_hash: transactionHash }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store"
    });
  } catch (error) {
    throw new Error("Could not reach the Zetra payment service. Check the URL and try again.", { cause: error });
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`Zetra returned a non-JSON response (HTTP ${response.status}).`, { cause: error });
  }
  if (!response.ok) {
    const message = body?.error?.message;
    throw new Error(typeof message === "string" ? message : `Zetra could not verify the transaction (HTTP ${response.status}).`);
  }
  const verification = body?.verification;
  if (verification?.recorded !== true || verification.transaction_hash !== transactionHash) {
    throw new Error("Zetra did not confirm this transaction as recorded. No payment proof was produced.");
  }

  const statuses = Array.isArray(verification.payment_statuses)
    ? verification.payment_statuses.filter((status) => typeof status === "string")
    : [];
  const payments = Array.isArray(body.payments) ? body.payments : [];
  const matchingPayments = payments.filter((payment) =>
    payment?.simulated === false && payment?.transaction_hash === transactionHash
  );
  const disposition = statuses.includes("needs_review")
    ? "held_for_review"
    : statuses.includes("overpaid")
      ? "overpaid_recorded"
      : statuses.includes("partial")
        ? "partially_applied"
        : statuses.includes("matched")
          ? "applied_to_invoice"
          : "recorded_for_accounting_review";

  return {
    result: "finalized_near_transfer_recorded",
    network: body.pay?.network?.id ?? null,
    token_contract: body.pay?.asset?.address ?? null,
    payer_account_id: payer,
    recipient_account_id: body.pay?.recipient ?? null,
    invoice_state: verification.invoice_state ?? body.state ?? null,
    disposition,
    payment_statuses: statuses,
    transaction_hash: transactionHash,
    evidence: matchingPayments.map((payment) => ({
      amount: payment.amount,
      status: payment.status,
      explorer_url: payment.explorer_url
    }))
  };
}

const USAGE = `Verify an actual NEAR payment against Zetra's finalized transaction verifier.

Usage:
  npm run near:verify -- --payment-url <https://app/pay/<token>> --payer <payer.testnet> --tx <transaction-hash>

This calls the payment page's public verification endpoint and may ingest/reconcile the finalized
transfer into the workspace. Repeated verification is idempotent. It does not submit a wallet
transaction, create a simulation, or print the payment-link token. A finalized transfer held for
review is reported as held_for_review; it is not described as applied to an invoice.`;

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${USAGE}\n`);
      return;
    }
    const proof = await verifyNearPayment(args);
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

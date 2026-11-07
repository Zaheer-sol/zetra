#!/usr/bin/env node
/**
 * Send one signed test order to an order source, exactly as a store or backend would.
 *
 *   ZETRA_ORDER_SECRET=osec_… node scripts/send-test-order.mjs <inbound-url> [external-id] [amount] [tax]
 *
 * Create the source first in Zetra (Developers → Orders → Connect a source → "Your checkout or
 * backend"): it shows the inbound address and the secret once. The secret is read from the
 * environment so it never lands in your shell history.
 */
import { createHmac, randomBytes } from "node:crypto";

const [url, externalId = `T-${randomBytes(3).toString("hex").toUpperCase()}`, amount = "108.00", tax = "8.00"] = process.argv.slice(2);
const secret = process.env.ZETRA_ORDER_SECRET;
if (!url || !secret) {
  console.error("Usage: ZETRA_ORDER_SECRET=osec_… node scripts/send-test-order.mjs <inbound-url> [external-id] [amount] [tax]");
  process.exit(1);
}

const body = JSON.stringify({
  external_id: externalId,
  title: "Tote bag",
  amount,
  tax,
  customer: { external_ref: "cus_demo", name: "Bola Adeyemi", email: "bola@example.com" }
});
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-zetra-timestamp": String(timestamp), "x-zetra-signature": `v1=${signature}`, "x-zetra-delivery-id": `order-${externalId}` },
  body
});
console.log(res.status, await res.text());

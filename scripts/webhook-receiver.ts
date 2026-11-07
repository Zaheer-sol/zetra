import { createServer } from "node:http";
import { verifyZetraWebhook } from "../backend/packages/sdk/src";

/**
 * A tiny local webhook receiver for development. Verifies every Zetra signature and prints the event.
 */
const port = Number(process.env.RECEIVER_PORT ?? 4040);
const secret = process.env.ZETRA_WEBHOOK_SECRET?.trim() ?? "";
if (!secret) console.warn("No secret: set ZETRA_WEBHOOK_SECRET. Signatures will fail.");

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const ok = verifyZetraWebhook(secret, body, req.headers["x-zetra-timestamp"] as string, req.headers["x-zetra-signature"] as string);
    if (!ok) {
      console.log(`✗ rejected ${req.headers["x-zetra-event-type"]}, invalid signature`);
      res.writeHead(400).end("invalid signature");
      return;
    }
    const event = JSON.parse(body);
    const d = event.data ?? {};
    console.log(`✓ ${event.type}  ${d.invoice?.number ?? ""} ${d.customer?.name ?? ""} ${d.payment?.amount ?? ""} ${d.payment?.asset ?? ""}  [${req.headers["x-zetra-delivery-id"]}]`);
    res.writeHead(200, { "content-type": "application/json" }).end('{"received":true}');
  });
}).listen(port, () => console.log(`Zetra webhook receiver listening on http://localhost:${port}/webhooks`));

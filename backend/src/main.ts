import { appEnv } from "@zetra/config";
import { closePools } from "@zetra/database";
import { buildServer } from "./server";

process.env.ZETRA_SERVICE ??= "zetra-api";
const env = appEnv();
const app = await buildServer();
await app.listen({ host: env.API_HOST, port: env.API_PORT });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await closePools();
    process.exit(0);
  });
}

import { loadEnvFile } from "../backend/packages/database/src/load-env";
import { migrate, resetSchema } from "../backend/packages/database/src/migrator";

export default async function setup() {
  loadEnvFile();
  const url = process.env.TEST_MIGRATION_DATABASE_URL ?? "postgresql://zetra:zetra@localhost:5432/zetra_test";
  if (!/zetra_test/.test(url)) throw new Error(`Refusing to reset a non-test database: ${url}`);
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://zetra_app:zetra_app@localhost:5432/zetra_test";
  process.env.NEAR_TESTNET_ENABLED = process.env.NEAR_TESTNET_ENABLED ?? "true";
  process.env.NEAR_TESTNET_USDC_CONTRACT_ID = process.env.NEAR_TESTNET_USDC_CONTRACT_ID ?? "usdc.fakes.testnet";
  process.env.NEAR_TESTNET_START_HEIGHT = process.env.NEAR_TESTNET_START_HEIGHT ?? "1";
  await resetSchema(url);
  await migrate(url, () => undefined);
}

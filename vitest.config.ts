import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["backend/packages/*/src/**/*.test.ts", "backend/src/**/*.unit.test.ts", "backend/worker/src/**/*.unit.test.ts"],
          environment: "node"
        }
      },
      {
        test: {
          name: "integration",
          include: ["backend/packages/*/test/**/*.test.ts", "backend/test/**/*.test.ts", "backend/worker/test/**/*.test.ts"],
          environment: "node",
          // Integration suites share one Postgres database; run files serially.
          // (fileParallelism alone is not applied per project; a single fork enforces it.)
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          setupFiles: ["./test/setup-env.ts"],
          globalSetup: ["./test/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000
        }
      }
    ]
  }
});

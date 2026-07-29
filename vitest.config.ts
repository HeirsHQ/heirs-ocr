import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Deterministic unit/integration tests; no watch in CI.
    watch: false,
  },
});

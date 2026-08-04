import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Deterministic unit/integration tests; no watch in CI.
    watch: false,
    // Required env vars have no defaults (no credentials baked into source), and
    // tests don't load a .env — supply harmless placeholders so config/env parses.
    env: {
      ADMIN_BOOTSTRAP_EMAIL: "test-owner@example.com",
      ADMIN_BOOTSTRAP_PASSWORD: "test-password-123",
    },
  },
});

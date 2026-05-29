import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Web Crypto (globalThis.crypto), Buffer, and tlock-js all work under Node.
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
    // BLS pairing + drand network round-trips are slow; give them room.
    testTimeout: 30_000,
  },
})

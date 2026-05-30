import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" path alias so route handlers (which import @/lib/...) load in tests.
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // Web Crypto (globalThis.crypto), Buffer, and tlock-js all work under Node.
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
    // BLS pairing + drand network round-trips are slow; give them room.
    testTimeout: 30_000,
  },
})

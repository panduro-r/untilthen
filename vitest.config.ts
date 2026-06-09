import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" path alias so route handlers (which import @/lib/...) load in tests.
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` is a Next build-time guard that throws outside a Server Component graph; it's
      // meaningless under vitest, so stub it so server modules (lib/session) import cleanly in tests.
      "server-only": fileURLToPath(new URL("./lib/__tests__/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    // Web Crypto (globalThis.crypto), Buffer, and tlock-js all work under Node.
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
    // BLS pairing + drand network round-trips are slow; give them room.
    testTimeout: 30_000,
  },
})

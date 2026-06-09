// Test stub for the `server-only` package (aliased in vitest.config.ts). The real package throws when
// imported outside a Next Server Component graph; under vitest there's no such graph, so this no-op
// lets server modules (e.g. lib/session) import cleanly in unit/integration tests.
export {}

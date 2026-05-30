// Apply the SQL migrations to a Postgres database in order.
// Usage: SUPABASE_DB_URL=postgres://... node scripts/migrate.mjs
// (Reads SUPABASE_DB_URL from the env or from .env.local.)

import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import pg from "pg"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")

// Minimal .env.local loader (only SUPABASE_DB_URL is needed here).
function loadEnv() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  try {
    const text = readFileSync(join(root, ".env.local"), "utf8")
    for (const line of text.split("\n")) {
      const m = line.match(/^SUPABASE_DB_URL=(.+)$/)
      if (m) return m[1].trim()
    }
  } catch {}
  return undefined
}

const connectionString = loadEnv()
if (!connectionString) {
  console.error("SUPABASE_DB_URL is not set (env or .env.local).")
  process.exit(1)
}

const migrationsDir = join(root, "supabase", "migrations")
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8")
    process.stdout.write(`applying ${file} ... `)
    await client.query(sql)
    console.log("ok")
  }
  console.log("All migrations applied.")
} catch (e) {
  console.error("\nMigration failed:", e.message)
  process.exitCode = 1
} finally {
  await client.end()
}

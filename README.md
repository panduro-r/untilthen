# Until Then

A **dead man's switch for sensitive files.** Encrypt a file in your browser, store the ciphertext on
Shelby (decentralized storage on Aptos), and set a condition that controls when the decryption key is
released — a **time-lock** (drand) or a **multi-sig** of people you trust. Recipients decrypt locally.

**Core invariant:** no server — and no one who breaks into our servers — can decrypt any drop before
its condition is met. The backend only ever holds drand-timelocked or threshold-gated material, never
a usable key. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) and the in-app **/security** page.

## How it works

- **Encryption** — AES-256-GCM in the browser (`lib/crypto.ts`). The key `K` is split `K = shardA ⊕ shardB`
  (XOR 2-of-2) for private drops; public drops gate `K` directly.
- **Time-lock** — the gated secret is drand-timelock-encrypted with `tlock-js` (`lib/timelock.ts`); it
  becomes recoverable only once the drand round publishes. The owner keeps a wallet-wrapped copy to
  reset the timer.
- **Multi-sig** — the secret is IBE-encrypted to `identity = dropId` under an owner-dealt signer-group
  BLS key (`lib/threshold.ts`, reusing tlock-js's audited Boneh–Franklin IBE). Each signer publishes a
  BLS signature share on-chain; at threshold, anyone aggregates them into the IBE key. On-chain
  verification + release lives in the Move contract (`contracts/untilthen`).
- **Per-recipient** — `shardB` is wrapped per recipient (email: an HKDF of a URL-fragment secret;
  wallet: a hash of a registration signature).
- **Metadata minimization** — drop titles and recipient emails are encrypted at rest; a DB dump
  reveals neither titles nor who the recipients are.

## Stack

Next.js 16 · React 19 · TypeScript (strict) · Tailwind v4 · Zustand · Supabase (Postgres + RLS) ·
Resend · `@aptos-labs/wallet-adapter-react` v8 (Petra) · `@noble/curves` · `tlock-js` · Aptos Move.

## Running locally

```bash
npm install
cp .env.example .env.local      # fill in the values (see below)
npm run dev                     # http://localhost:3000
npm test                        # unit + integration (vitest)
npm run build                   # production build
```

### Environment

See [`.env.example`](./.env.example). Key vars: `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` (the app uses real Supabase when both are set, else an in-memory mock),
`NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS` + `NEXT_PUBLIC_APTOS_NETWORK` (multi-sig), `RESEND_API_KEY` +
`EMAIL_FROM` (email; the notifier only sends when set), `EMAIL_ENC_KEY` + `CRON_SECRET`.

### Database

Apply migrations in order (`supabase/migrations/000{1,2,3,4}*.sql`) — e.g. via the Supabase SQL
editor, or `SUPABASE_DB_URL=… node scripts/migrate.mjs`. They create four tables + RLS + the atomic
SQL functions (single-statement burn / optimistic-concurrency reset / idempotent release).

### Move contract

Compiled + tested (`aptos move test`, 4/4) and deployed to **devnet** — see
[`contracts/untilthen/DEPLOYMENT.md`](./contracts/untilthen/DEPLOYMENT.md) for the address and
reproducible deploy steps (testnet/mainnet identical, just funded differently).

## Tests

`npm test` runs the unit + route suites against in-memory mocks (no network). Two integration suites
are gated:

- `RUN_SMOKE=1 npx vitest run lib/__tests__/smoke-supabase.test.ts` — the Supabase adapter against a
  real project (atomic burn, idempotent release, optimistic-concurrency reset).
- `RUN_CHAIN=1 npx vitest run lib/__tests__/multisig-chain.test.ts` — the **entire multi-sig flow
  against the deployed contract**: deal → ECIES-seal shares → IBE-encrypt → `create_drop` → signers
  approve on-chain (the contract's BLS verify accepts them) → aggregate → recover the exact secret.

## Status

Built and verified: the full time-lock journey (create → fund → encrypt → condition → arm → dashboard
→ reset → retrieve), the multi-sig journey (configure → register signers → arm on-chain → approve
on-chain → notify → retrieve), live Supabase, the deployed + tested Move contract, all 12 pages, the
funding layer, and a security review with both findings fixed.

Not yet done: email goes live once a sending domain is verified in Resend (the pipeline is built);
the wallet-gated flows want a real Petra click-through (the cryptography is unit/integration-tested);
Subresource-Integrity / reproducible-build verification is future launch-hardening (see ARCHITECTURE
"Verifiable delivery"). The Shelby SDK is access-gated, so blob storage uses an IndexedDB-backed mock
with the same API surface.

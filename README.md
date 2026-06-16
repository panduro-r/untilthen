# Until Then

A **dead man's switch for sensitive files.** Encrypt a file in your browser, store the ciphertext on
Shelby (decentralized storage on Aptos), and set a condition that controls when the decryption key is
released — a **time-lock** (drand) or a **multi-sig** of people you trust. Recipients decrypt locally.

**Core invariant:** no server — and no one who breaks into our servers — can decrypt any drop before
its condition is met. The backend only ever holds drand-timelocked or threshold-gated material, never
a usable key. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) and the in-app **/security** page.

**Live at [untilthen.xyz](https://untilthen.xyz)** (Vercel), running on Aptos **Shelbynet**.

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
- **Release timing** — an Upstash QStash one-shot per safe POSTs `/api/cron/release` at the release
  moment (`lib/qstash.ts`); a daily Vercel cron is the backstop. Email goes out via Resend.
- **Auth** — Sign-In-With-Aptos gives a read-only session cookie (`ut_session`). Every mutating or
  secret-returning route still verifies a fresh per-action wallet signature — the session never
  unlocks a secret. Same-origin CSRF guard + enforced CSP/HSTS headers.

## Stack

Next.js 16 · React 19 · TypeScript (strict) · Tailwind v4 · Zustand · Supabase (Postgres + RLS) ·
Resend · Upstash QStash · `jose` (SIWA/JWT) · `@aptos-labs/wallet-adapter-react` v8 (Petra) ·
`@noble/curves` · `tlock-js` · Shelby SDK · Aptos Move.

## Running locally

```bash
npm install
cp .env.example .env.local      # fill in the values (see below)
npm run dev                     # http://localhost:3000
npm test                        # unit + integration (vitest)
npm run build                   # production build
```

### Environment

See [`.env.example`](./.env.example). `NEXT_PUBLIC_*` vars bake in at **build time** — changing them
on Vercel needs a redeploy. Key vars:

- **Chain** — `NEXT_PUBLIC_APTOS_NETWORK=shelbynet`, `NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS`
  (the `until_then` module address; the env-var name keeps the legacy prefix), `NEXT_PUBLIC_APP_URL`
  (QStash callback target).
- **Storage** — `NEXT_PUBLIC_USE_SHELBY_MOCK=true` swaps real Shelby for an IndexedDB mock (same API);
  `NEXT_PUBLIC_SHELBY_MAX_BLOB_HOURS` caps blob lifetime.
- **Data + email** — `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (real Supabase when both
  are set, else in-memory mock); `RESEND_API_KEY` + `EMAIL_FROM`; `QSTASH_TOKEN` + `QSTASH_URL`.
- **Server secrets** (never `NEXT_PUBLIC_`) — `EMAIL_ENC_KEY`, `CRON_SECRET`, `AUTH_SESSION_SECRET`.

### Database

Apply migrations in order (`supabase/migrations/000{1..6}*.sql`) — e.g. via the Supabase SQL
editor, or `SUPABASE_DB_URL=… node scripts/migrate.mjs`. They create the tables + RLS policies + the
atomic SQL functions (single-statement burn / optimistic-concurrency reset / idempotent release).
Migrations are **not** idempotent — apply only the new file when adding one.

### Move contract

Module `until_then`, compiled + tested (`aptos move test`, 4/4) and **deployed to Shelbynet** at
`0x5b736a89…6e19` — see [`contracts/untilthen/DEPLOYMENT.md`](./contracts/untilthen/DEPLOYMENT.md)
for the txns and reproducible deploy steps. Deploy via `scripts/deploy-untilthen-shelbynet.mjs` (the
Shelbynet gateway needs an `Origin` header the aptos CLI can't send, so the TS SDK does it).

## Tests

`npm test` runs the unit + route suites against in-memory mocks (no network). Two integration suites
are gated:

- `RUN_SMOKE=1 npx vitest run lib/__tests__/smoke-supabase.test.ts` — the Supabase adapter against a
  real project (atomic burn, idempotent release, optimistic-concurrency reset).
- `RUN_CHAIN=1 npx vitest run lib/__tests__/multisig-chain.test.ts` — the **entire multi-sig flow
  against the deployed contract**: deal → ECIES-seal shares → IBE-encrypt → `create_drop` → signers
  approve on-chain (the contract's BLS verify accepts them) → aggregate → recover the exact secret.

## Status

**Live and end-to-end on Shelbynet.** Both journeys work start to finish: time-lock (create → fund →
encrypt → condition → arm → dashboard → reset → retrieve) and multi-sig (configure → register signers
→ arm on-chain → approve on-chain → notify → retrieve). Running with real Shelby storage
(owner-wallet-paid, `lib/shelby.real.ts`), live Supabase, live email (Resend, domain verified),
SIWA auth, QStash release scheduling, enforced CSP/HSTS, the deployed + tested Move contract, all 12
pages, and a security review with findings fixed.

Open items: a real multi-wallet Petra click-through of the multi-sig flow (the cryptography is
unit/integration-tested); Subresource-Integrity / reproducible-build verification (launch-hardening,
see ARCHITECTURE "Verifiable delivery"); a release-window guardrail for the 48h blob cap. Setting
`NEXT_PUBLIC_USE_SHELBY_MOCK=true` falls back to an IndexedDB mock with the same API surface for
local dev without Shelby access.

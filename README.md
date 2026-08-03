# Until Then

A **dead man's switch for sensitive files.** Encrypt a file in your browser, store the ciphertext on
Shelby (decentralized storage on Aptos), and set a condition that controls when the decryption key is
released — a **time-lock** (drand) or a **multi-sig** of people you trust. Recipients decrypt locally.

**Core invariant:** no server — and no one who breaks into our servers — can decrypt any drop before
its condition is met. The backend only ever holds drand-timelocked or threshold-gated material, never
a usable key. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) and the in-app **/security** page.

**Live at [untilthen.xyz](https://untilthen.xyz)** (Vercel). The app **follows the connected wallet's
network**: Shelbynet and Aptos Testnet both work end to end. Mainnet/Devnet are recognized but gated
("coming soon") because Shelby storage doesn't exist there yet.

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
- **Release timing** — time-locks schedule an Upstash QStash one-shot that POSTs `/api/cron/release`
  at the release moment (`lib/qstash.ts`). Multi-sigs have no release *time*, so the approve page pings
  `POST /api/drops/[id]/reconcile` the instant the threshold is met and the email goes out immediately
  (`lib/releaseNotify.ts`). A daily Vercel cron backstops both. Email via Resend.
- **Per-network safes** — each drop stores the network it was armed on (`drops.network`); the contract
  address, Shelby endpoint, and API keys are all resolved per network in `lib/networks.ts`.
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

- **Contract (per network)** — `NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS` is the Shelbynet address (the
  env-var name keeps the legacy prefix) and `NEXT_PUBLIC_CONTRACT_ADDRESS_TESTNET` the Testnet one.
  `NEXT_PUBLIC_APTOS_NETWORK` is only a default hint for the wallet adapter now — the live network
  comes from the wallet. `NEXT_PUBLIC_APP_URL` is the QStash callback target.
- **API keys are network-scoped** — a Shelbynet key returns 401 on Testnet, so keys are per network:
  `NEXT_PUBLIC_SHELBY_API_KEY` / `NEXT_PUBLIC_SHELBY_API_KEY_TESTNET` (Shelby storage, from
  [geomi.dev](https://geomi.dev) — must be a *client* key) and `NEXT_PUBLIC_APTOS_API_KEY_TESTNET`
  (Aptos fullnode; without it the public Testnet node throttles reads to seconds). Both are
  browser-side rate-limit keys, not secrets.
- **Storage** — `NEXT_PUBLIC_USE_SHELBY_MOCK=true` swaps real Shelby for an IndexedDB mock (same API);
  `NEXT_PUBLIC_SHELBY_MAX_BLOB_HOURS` caps blob lifetime (48h network cap today).
- **Data + email** — `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (real Supabase when both
  are set, else in-memory mock); `RESEND_API_KEY` + `EMAIL_FROM`; `QSTASH_TOKEN` + `QSTASH_URL`.
- **Server secrets** (never `NEXT_PUBLIC_`) — `EMAIL_ENC_KEY`, `CRON_SECRET`, `AUTH_SESSION_SECRET`.

### Database

Apply migrations in order (`supabase/migrations/00{01..10}*.sql`) — e.g. via the Supabase SQL
editor, or `SUPABASE_DB_URL=… node scripts/migrate.mjs [file]`. They create the tables + RLS policies
+ the atomic SQL functions (single-statement burn / optimistic-concurrency reset / idempotent
release). Migrations are **not** idempotent — apply only the new file when adding one.

Note: the live functions have drifted from the early migration files, so **dump the current
definition before recreating one** (`select pg_get_functiondef(oid) …`) rather than copying from
`0002`.

### Move contract

Module `until_then`, compiled + tested (`aptos move test`, 4/4), deployed to both live networks:

| Network | Address |
|---|---|
| Shelbynet | `0x5b736a89…6e19` |
| Testnet | `0x91d4659c…3da0` |

On-chain BLS verification goes through `aptos_std::crypto_algebra` + `bls12381_algebra` with the NUL
hash-to-G2 DST, **not** the high-level `bls12381` module (that one uses the proof-of-possession
scheme, which would reject a share that must also aggregate into a valid IBE key).

Testnet deploys with the standard `aptos move publish`. Shelbynet needs
`scripts/deploy-untilthen-shelbynet.mjs`, because its gateway requires an `Origin` header the aptos
CLI can't send. Txns + reproducible steps: [`contracts/untilthen/DEPLOYMENT.md`](./contracts/untilthen/DEPLOYMENT.md).

## Tests

`npm test` runs the unit + route suites against in-memory mocks (no network). Two integration suites
are gated:

- `RUN_SMOKE=1 npx vitest run lib/__tests__/smoke-supabase.test.ts` — the Supabase adapter against a
  real project (atomic burn, idempotent release, optimistic-concurrency reset).
- `RUN_CHAIN=1 npx vitest run lib/__tests__/multisig-chain.test.ts` — the **entire multi-sig flow
  against the deployed contract**: deal → ECIES-seal shares → IBE-encrypt → `create_drop` → signers
  approve on-chain (the contract's BLS verify accepts them) → aggregate → recover the exact secret.

## Status

**Live and end-to-end on Shelbynet and Testnet.** Both journeys are verified with real wallets on
both networks: time-lock (create → fund → encrypt → condition → arm → dashboard → check in → reset →
retrieve) and multi-sig (configure → register signers → arm on-chain → approve on-chain with separate
wallets → notify → retrieve). Running with real Shelby storage (owner-wallet-paid,
`lib/shelby.real.ts`), live Supabase, live email (Resend, domain verified), SIWA auth, QStash
scheduling, enforced CSP/HSTS, the deployed + tested Move contract, all 12 pages, and a security
review with findings fixed. 112 tests pass (11 skipped = `RUN_CHAIN` / `RUN_SMOKE` live-net suites).

Open items: Subresource-Integrity / reproducible-build verification (launch-hardening, see
ARCHITECTURE "Verifiable delivery").

**Storage lifetime is parked on purpose.** Shelby currently caps a blob at 48h (was 24h, expected to
rise, no ETA), so there's deliberately no arm-date guardrail, no check-in-extends-storage renewal, and
no user-facing copy about it while the cap is still moving. When it settles, the first thing to fix is
that `lib/decrypt.ts` burns the one-time retrieval link *before* downloading the blob — an expired
blob would consume the link and lose the file.

For local dev without Shelby access, `NEXT_PUBLIC_USE_SHELBY_MOCK=true` falls back to an
IndexedDB-backed mock with the same API surface.

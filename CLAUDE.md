# CLAUDE.md

**Until Then** — dead man's switch for sensitive files. AES-256-GCM client-side encryption, ciphertext on Shelby (Aptos), decryption key gated by drand timelock or threshold-BLS multisig. Operator never holds a decryptable secret. See `ARCHITECTURE.md` for the full design; `BUILDING.md` for the original step-by-step build instructions.

---

## Non-negotiable rules

1. **No plaintext outside the browser.** Encrypt/decrypt in `lib/crypto.ts` only. Never `fetch('/api/...', { body: fileData })`.

2. **Operator never holds a decryptable secret.** Store only: `tlock_shard_a` (drand-locked), `ibe_header`+`contract_ref` (BLS-threshold locked), or XOR-wrapped owner copy. No raw shardA/K ever. Ask: "if the DB were dumped right now, could an attacker decrypt?" — must be no.

3. **TypeScript strict, no `any`.** Use `unknown` + narrow it. Comment any `as X` cast.

4. **Crypto only in `lib/crypto.ts`.** No Web Crypto calls in components, pages, or routes. Components call named exports.

5. **`/design/` is the UI source of truth.** Match it. No new patterns. Use the existing component vocabulary for new pages.

6. **Wallet calls through `lib/aptos.ts`.** Never `window.aptos` or raw adapter hooks in components.

7. **Server secrets stay server-side.** `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `EMAIL_ENC_KEY` — never in client files, never `NEXT_PUBLIC_`.

8. **Retrieval burns atomically.** `UPDATE … WHERE released_at IS NULL RETURNING …` in one query. If 0 rows → 410. No separate SELECT+UPDATE.

9. **Check SDK docs before writing SDK calls.** Shelby: `docs.shelby.xyz/sdks/`; Aptos: `aptos.dev/build/sdks/ts-sdk`; Supabase: `supabase.com/docs/reference/javascript`; Resend: `resend.com/docs/api-reference`.

10. **Shelby SDK is access-gated.** `NEXT_PUBLIC_USE_SHELBY_MOCK=true` activates `lib/shelby.mock.ts` (IndexedDB). Dashboard shows a banner.

---

## Current state (2026-06)

**Effectively feature-complete and LIVE on `untilthen.xyz`** (Vercel + custom domain). All 12 pages + full backend built. GitHub: `panduro-r/untilthen` (private). Supabase live (`gmcfzerukcnskpyrguwo`). **The app runs entirely on Shelbynet** (storage + contract + wallet share one network). Move contract on **Shelbynet**: `0xd758b474abfd383c1bae7a41c5a081052bac4ffe514e37dfd485205e433f6cb0`, module `dead_drop` (verified live on-chain). (Old Devnet deploy `0x6b97…5fc4` is superseded — see `contracts/deaddrop/DEPLOYMENT.md`.) Vercel cron runs `/api/cron/release` daily. 90 tests pass (7 skipped = live-network/RUN_CHAIN gated).

**Env-var gotcha:** `NEXT_PUBLIC_*` are baked in at BUILD time. Changing them in Vercel has no effect until a **redeploy**. The two that must be `shelbynet`/the Shelbynet address: `NEXT_PUBLIC_APTOS_NETWORK=shelbynet`, `NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS=0xd758b474…6cb0`. `getBalances` (lib/funding.ts) and the wallet adapter (Providers.tsx) both read `NEXT_PUBLIC_APTOS_NETWORK` — if it's wrong, balances/funding read the wrong network and show 0.

**Major systems all wired:**
- **Timelock + multisig both end-to-end** — arm, retrieve, reset, approve, notifier all done. Multisig crypto+contract proven by `RUN_CHAIN` tests; the multi-signer UI path still wants a real multi-wallet browser run.
- **Real Shelby storage** (`lib/shelby.real.ts`, verified on Shelbynet) — owner wallet signs + pays `register_blob`; blob namespaced by owner address; download is signer-less. Toggle with `NEXT_PUBLIC_USE_SHELBY_MOCK=false`. Shelbynet caps blob life at 48h (renewal logic in `lib/shelby.ts`). Default is still mock.
- **SIWA auth** (Sign In With Aptos) — JWT session cookie `ut_session` (`lib/session.ts`, `/api/auth/{login,logout,session}`, `store/session.ts`). Authorizes READS only (e.g. cross-device dashboard via `GET /api/drops`); every mutation/secret action still needs a fresh per-action wallet signature (`lib/auth.verifyOwnerAuth`).
- **Security hardening** (commit 05e6ce7): CSP (report-only — see gotcha), HSTS, X-Frame-Options, same-origin CSRF guard (`lib/origin.ts`) on cookie-authorized mutations.
- **Vuln-2 FIXED** (commit c650d8c): signer/recipient slots bound to owner-designated `wallet_address` at arm time.

**Remaining open items:**
- **Email not configured yet** — Resend `RESEND_API_KEY`/`EMAIL_FROM` unset, domain unverified; the notifier currently only counts, sends nothing. Recipients/signers get no email until this is wired. (Timelock recipients can still self-retrieve once the drand round publishes; the email is convenience.)
- Multisig multi-signer UI end-to-end run with real Petra wallets (crypto already proven)
- CSP is still `Content-Security-Policy-Report-Only`; flip to enforcing once prod console is clean
- SRI / reproducible-build not yet done

**Terminology:** user-facing UI calls a drop a **"safe"** (owner route `/safe/[id]`, new IDs `safe_…`). Internally / in DB / in protocol, it's still `drop` / `drop_id` / `dropId` — do not rename those (breaks crypto identity binding). Retrieval routes stay `/r`, `/p`.

**Stack:** Next 16 / React 19 / Tailwind v4 (no `@import "tailwindcss"` — see gotcha below). Vitest (`npm test`). `wallet-adapter-react` v8 (AIP-62, Petra auto-detected, no petra-plugin pkg). `jose` for JWT sessions.

---

## Critical gotchas

**Tailwind v4 collision — DO NOT add `@import "tailwindcss"` to `app/globals.css`.** Tailwind's auto-generated `h-1/h-2/h-3` and `text-sm/text-xs` utilities collide with the design's `.h-1/.h-2/.text-sm` classes and collapse all headings to ~4–8px. The design CSS is self-contained; Tailwind is not needed.

**signMessage uses a fixed nonce `"deaddrop"`** for deterministic signatures (needed for wrap-key reproducibility). Do not change this.

**Server-side signature verify uses `verifyAptosSignedMessage`** (verifies over the wallet's `fullMessage` = prefix+nonce, not the bare message). See `lib/aptos.ts`. Registration routes and `lib/auth.ts` use this — don't revert to bare-message verify.

**noble/curves v2 ESM imports** need the `.js` extension: `@noble/curves/bls12-381.js`. Point class is `bls.G1.Point` / `bls.G2.Point`.

**`shamir-secret-sharing` npm pkg is GF(256)**, not Fr-additive — cannot do threshold-BLS. `lib/threshold.ts` implements Shamir over `Fr` instead. Don't replace it.

**Migrations** `0001`–`0005` are bare `CREATE` (not idempotent). Apply only the new file when adding migrations. Use `node scripts/migrate.mjs`.

**SIWA session authorizes reads only.** The `ut_session` cookie never unlocks a secret. Any mutating or secret-returning route must still verify a fresh per-action wallet signature via `lib/auth.verifyOwnerAuth`, and cookie-authorized mutations must pass the `lib/origin.ts` same-origin check. Don't let the session stand in for a wallet signature.

**Server-only modules** import `"server-only"` (`lib/session.ts`, `lib/serverCrypto.ts`, etc.) so a client import fails the build. Keep that guard.

---

## Conventions

- Components: `PascalCase.tsx` | Libs: `camelCase.ts` | Pages: `page.tsx`
- `"use client"` pages use `ConnectGate` for auth gating
- Async UI: always handle `"idle" | "loading" | "success" | "error"`
- User-facing errors: plain language. Never show SDK error strings. Log to console with a `[module]` prefix.
- No comments unless the WHY is non-obvious. No docstrings.
- Stores: `store/wallet.ts` (in-memory, not persisted), `store/drops.ts` (localStorage cache, metadata only, never crypto material), `store/draft.ts` (in-memory, transient), `store/ui.ts` (modal state), `store/session.ts` (SIWA session state)
- Server-only secrets now also include `EMAIL_REPLY_TO` (cosmetic) and `AUTH_SESSION_SECRET` (JWT signing key — server-only, never `NEXT_PUBLIC_`)

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

LIVE on `untilthen.xyz` (Vercel). Feature-complete: 12 pages + backend, 90 tests pass (7 skipped = RUN_CHAIN/live-net). GitHub `panduro-r/untilthen` (private); Supabase `gmcfzerukcnskpyrguwo`. **Wallet-driven multi-network:** the app follows the connected wallet's network — **Shelbynet + Testnet both live** (Mainnet/Devnet recognized but gated "coming soon"; Shelby storage exists only on shelbynet/testnet). Move module **`until_then`** on Shelbynet at `0x5b736a89…6e19` and on Testnet at `0x91d4659c…3da0` (renamed from `dead_drop`; old addrs superseded — see `contracts/untilthen/DEPLOYMENT.md`). Per-network keys: `NEXT_PUBLIC_CONTRACT_ADDRESS_TESTNET`, `NEXT_PUBLIC_SHELBY_API_KEY_TESTNET`, `NEXT_PUBLIC_APTOS_API_KEY_TESTNET` (Shelby + Aptos keys are network-scoped; passed to the wallet adapter via `dappConfig.aptosApiKeys` for fast ANS). Deploy via `scripts/deploy-untilthen-shelbynet.mjs` (the Shelbynet gateway needs an `Origin` header the aptos CLI can't send). **Fuller live state + open items are in the auto-loaded memory.** One-line summary:

- Timelock + multisig both end-to-end (arm/retrieve/reset/approve). Real Shelby storage (`lib/shelby.real.ts`, owner-wallet-paid, 48h blob cap). SIWA auth (`ut_session` cookie, reads only; mutations need a fresh wallet sig). Security headers + same-origin CSRF guard (`lib/origin.ts`). Vuln-2 fixed.
- Release timing: **timelock** → Upstash QStash one-shot per safe (`lib/qstash.ts`) POSTs `/api/cron/release` at release time. **Multisig** (no release time) → the approve page pings `POST /api/drops/[id]/reconcile` (`notifyMultisigReleaseIfDue`) the moment the threshold is met, so the email fires immediately. **Daily 9am Vercel cron is the backstop for both.** Shared notifier: `lib/releaseNotify.ts` (only mutates state when Resend is configured). Email LIVE (Resend): heads-up at arm, one-time link at release (mode-aware copy — multisig has no check-in date).
- Security headers in `next.config.ts`: **CSP now ENFORCED** (was report-only; audited connect-src first), HSTS, X-Frame-Options, same-origin CSRF guard.
- Multisig multi-wallet flow verified end-to-end on Testnet (arm → register signers → approve → notify → retrieve). ✅
- Open: SRI/reproducible build. **Storage-lifetime work is PARKED by decision:** the 48h blob cap is a temporary Shelby-team cap (was 24h, expected to rise, no ETA), and this is a testing-phase project with no real users — so no arm-date guardrail, no check-in renewal, and no user-facing "storage lasts 48h" copy yet. When revisited, do the **don't-burn-the-link-on-a-dead-blob** fix first (`lib/decrypt.ts` burns the one-time link *before* downloading the blob → an expired blob permanently loses the file).

**Env-var gotcha:** `NEXT_PUBLIC_*` bake in at BUILD time — changing them on Vercel needs a **redeploy**. Required: `NEXT_PUBLIC_APTOS_NETWORK=shelbynet`, `NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS=0x5b736a89…6e19`, `NEXT_PUBLIC_APP_URL=https://untilthen.xyz` (QStash callback target). `getBalances`/wallet-adapter read `NEXT_PUBLIC_APTOS_NETWORK` — wrong value → balances show 0.

**Terminology:** UI says "safe" (`/safe/[id]`, `safe_…` ids); DB/protocol stay `drop`/`dropId` (renaming breaks crypto identity binding). Retrieval routes `/r`, `/p`.

**Stack:** Next 16 / React 19 / Tailwind v4 (no `@import "tailwindcss"` — gotcha below). Vitest (`npm test`). `wallet-adapter-react` v8 (AIP-62, Petra). `jose` JWT. Fonts: Hanken Grotesk / Fraunces / Spline Sans Mono.

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

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

**All 12 pages built, deployed.** GitHub: `panduro-r/untilthen` (private). Supabase live (`gmcfzerukcnskpyrguwo`). Move contract on devnet: `0x6b9735ae28dc3eb5d901ba89a64239c374f9334d0523c34a497f46ebe77e5fc4`, module `dead_drop`. Vercel cron runs `/api/cron/release` daily. 76 tests pass.

**Open items:**
- Vuln-2 full fix: bind registration slots to owner-designated `wallet_address` at creation (insert-once hardening is done; see `SECURITY TODO` in `app/api/register*/route.ts`)
- Resend domain not yet verified — add `RESEND_API_KEY`+`EMAIL_FROM` to `.env.local` when ready
- Multisig UI needs real Petra + multiple wallets for end-to-end browser test (crypto proven by `RUN_CHAIN` tests)
- SRI / reproducible-build not yet done
- Devnet resets ~weekly → re-deploy contract then (see `contracts/deaddrop/DEPLOYMENT.md`)

**Stack:** Next 16 / React 19 / Tailwind v4 (no `@import "tailwindcss"` — see gotcha below). Vitest (`npm test`). `wallet-adapter-react` v8 (AIP-62, Petra auto-detected, no petra-plugin pkg).

---

## Critical gotchas

**Tailwind v4 collision — DO NOT add `@import "tailwindcss"` to `app/globals.css`.** Tailwind's auto-generated `h-1/h-2/h-3` and `text-sm/text-xs` utilities collide with the design's `.h-1/.h-2/.text-sm` classes and collapse all headings to ~4–8px. The design CSS is self-contained; Tailwind is not needed.

**signMessage uses a fixed nonce `"deaddrop"`** for deterministic signatures (needed for wrap-key reproducibility). Do not change this.

**Server-side signature verify uses `verifyAptosSignedMessage`** (verifies over the wallet's `fullMessage` = prefix+nonce, not the bare message). See `lib/aptos.ts`. Registration routes and `lib/auth.ts` use this — don't revert to bare-message verify.

**noble/curves v2 ESM imports** need the `.js` extension: `@noble/curves/bls12-381.js`. Point class is `bls.G1.Point` / `bls.G2.Point`.

**`shamir-secret-sharing` npm pkg is GF(256)**, not Fr-additive — cannot do threshold-BLS. `lib/threshold.ts` implements Shamir over `Fr` instead. Don't replace it.

**Migrations** `0001`–`0004` are bare `CREATE` (not idempotent). Apply only the new file when adding migrations. Use `node scripts/migrate.mjs`.

---

## Conventions

- Components: `PascalCase.tsx` | Libs: `camelCase.ts` | Pages: `page.tsx`
- `"use client"` pages use `ConnectGate` for auth gating
- Async UI: always handle `"idle" | "loading" | "success" | "error"`
- User-facing errors: plain language. Never show SDK error strings. Log to console with a `[module]` prefix.
- No comments unless the WHY is non-obvious. No docstrings.
- Stores: `store/wallet.ts` (in-memory, not persisted), `store/drops.ts` (localStorage cache, metadata only, never crypto material), `store/draft.ts` (in-memory, transient), `store/ui.ts` (modal state)

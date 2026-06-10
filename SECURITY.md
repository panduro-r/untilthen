# Security posture — Until Then

A dead man's switch: files are encrypted **in the browser** (AES-256-GCM), ciphertext is stored on
Shelby, and the decryption key is split (XOR 2-of-2) and gated by **drand timelock** or an **on-chain
threshold-BLS/IBE multisig**. The operator never holds a usable secret. See `ARCHITECTURE.md`.

This file records the latest security review, the fixes applied, and the residual/known gaps.

## What the review confirmed sound

- **Core invariant** — no raw shardA / K is accepted or stored. `POST /api/drops` rejects any payload
  with a top-level `shard_a/key/secret/...` field; only drand-locked / IBE-locked / wallet-wrapped
  material is persisted. Verified against every route.
- **Atomic single-use retrieval** — `burn_recipient` is a single `UPDATE ... RETURNING` (verify
  released + within expiry + unburned + set `released_at`), so a concurrent claim can't decrypt twice.
- **Timelock reset** — atomic optimistic-concurrency swap (`expectedOldRound`), rejected after release.
- **SIWA sign-in** — Ed25519 signature verified, public-key→address binding checked, 5-minute
  freshness window, app-name domain binding (can't replay a signature from another site), JWT (HS256)
  in an `HttpOnly` + `Secure` cookie.
- **Secrets server-only** — `SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_ENC_KEY`, `CRON_SECRET`,
  `AUTH_SESSION_SECRET`, `SHELBY_UPLOADER_PRIVATE_KEY` are never `NEXT_PUBLIC_` and never imported into
  a client component (`server-only` guards enforce this at build).
- **Metadata minimization** — titles encrypted client-side; recipient/signer emails encrypted at rest
  under `EMAIL_ENC_KEY`. A DB dump reveals no titles, no recipient identities, and no decryptable key.
- **No plaintext leaves the browser** — confirmed by `scripts/verify-encrypted.mjs` and the in-app
  "Verify encryption" button: the stored blob is high-entropy, header-less ciphertext.
- **TypeScript strict, no `any`** in production code; user-facing errors don't leak stack traces.

## Fixes applied in this review

- **HTTP security headers** (`next.config.ts`, all routes): `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS,
  `Permissions-Policy`, and a **Content-Security-Policy (Report-Only)**. (Report-only first so it
  can't break the live wallet/SDK flow — see "flip CSP to enforcing" below.)
- **CSRF hardening** on the cookie-authorized mutating routes (`POST /api/drops` via session,
  `POST /api/drops/[id]/delete`): the session cookie is now `SameSite=Strict`, **and** the routes
  reject any request whose `Origin` is not our app (`lib/origin.ts`). Create also rejects a body
  `ownerAddress` that doesn't match the session (confused-deputy guard).
- **Crypto cleanups**: removed a dead/stale `titleKeyMessage()` + `TITLE_KEY_MESSAGE` from
  `lib/crypto.ts` (the live, single-source-of-truth message is in `lib/titleKey.ts`); added field
  validation to the IBE-header deserializer (`lib/threshold.ts`).

## Residual / known gaps (accepted or deferred)

1. **CSP is Report-Only.** Once the production console shows no CSP violations (wallet, Shelby WASM,
   drand, Supabase, fonts), rename the header in `next.config.ts` from
   `Content-Security-Policy-Report-Only` to `Content-Security-Policy` to enforce it. Note: enforcing a
   strict `script-src` ideally uses per-request nonces (needs middleware) — the current policy keeps
   `'unsafe-inline'` for Next's inline bootstrap, so its XSS value is partial. The app does not inject
   raw HTML (no React raw-HTML escape hatch anywhere), so the practical XSS surface is small.
2. **Transitive `uuid` advisory (8 × moderate).** Comes from `@aptos-connect/web-transport` →
   `@aptos-labs/wallet-adapter-core`. That chain is the **AptosConnect / keyless** path, which we
   deliberately exclude (`optInWallets={["Petra"]}`), so the vulnerable code never loads. The only
   `npm audit fix` downgrades the wallet adapter v8→v3 (breaking). Tracked upstream; re-check on
   adapter updates.
3. **Verifiable delivery / SRI** — the deployed frontend is trusted as served (no Subresource Integrity
   hashes, no reproducible-build attestation). This is the residual "frontend delivery trust" risk in a
   client-side-crypto app and a `CLAUDE.md` definition-of-done item still open. Mitigation path:
   reproducible build + published bundle hashes in a public log. Deferred.
4. **No rate limiting** on the unauthenticated public endpoints (`/api/public`, `/api/register*`,
   `/api/retrieve`). The cryptographic gate is the real control (probing returns a uniform `410`), so
   this is operational hardening, not a confidentiality risk. Add edge rate limiting (e.g. Upstash)
   before a public launch.
5. **Recipient slot binding** — wallet recipients are currently disabled (email recipients only), so
   the registration-slot-hijack concern is not live. Multisig **signer** slots are bound at arm time:
   `armDrop` rejects a registered signer whose wallet ≠ the owner-designated address.
6. **Same-origin check & previews** — because mutating routes require `Origin === NEXT_PUBLIC_APP_URL`
   (or localhost), creating/deleting safes works on the canonical domain (`untilthen.xyz`) and local
   dev, but **not** on Vercel preview URLs. Demo and test on the production domain. (The Shelby API key
   is likewise origin-locked to `untilthen.xyz`.)

## Operational notes

- Rotate `AUTH_SESSION_SECRET` to invalidate all sessions. Disconnecting the wallet clears the session
  client-side; the cookie expires after 7 days.
- The Shelby uploader key model is **not** used in production — uploads are signed and paid by the
  owner's own wallet (no server custody of storage funds).

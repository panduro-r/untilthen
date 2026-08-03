# Security posture — Until Then

A dead man's switch: files are encrypted **in the browser** (AES-256-GCM), ciphertext is stored on
Shelby, and the decryption key is split (XOR 2-of-2) and gated by **drand timelock** or an **on-chain
threshold-BLS/IBE multisig**. The operator never holds a usable secret. See `ARCHITECTURE.md`.

This file records the security review (2026-06), the fixes applied, the hardening done since, and the
residual/known gaps.

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
  `AUTH_SESSION_SECRET` are never `NEXT_PUBLIC_` and never imported into a client component
  (`server-only` guards enforce this at build). `SHELBY_UPLOADER_PRIVATE_KEY` survives only in the
  gated live-net test (`lib/__tests__/shelby-real.test.ts`); production never uses a server uploader
  key — see "Operational notes".
- **Metadata minimization** — titles encrypted client-side; recipient/signer emails encrypted at rest
  under `EMAIL_ENC_KEY`. A DB dump reveals no titles, no recipient identities, and no decryptable key.
- **No plaintext leaves the browser** — confirmed by `scripts/verify-encrypted.mjs` and the in-app
  "Verify encryption" button: the stored blob is high-entropy, header-less ciphertext.
- **TypeScript strict, no `any`** in production code; user-facing errors don't leak stack traces.

## Fixes applied in this review

- **HTTP security headers** (`next.config.ts`, all routes): `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS,
  `Permissions-Policy`, and a **Content-Security-Policy**. Shipped report-only first so it couldn't
  break the live wallet/SDK flow; **now enforced** (see "Hardening since the review").
- **CSRF hardening** on the cookie-authorized mutating routes (`POST /api/drops` via session,
  `POST /api/drops/[id]/delete`): the session cookie is now `SameSite=Strict`, **and** the routes
  reject any request whose `Origin` is not our app (`lib/origin.ts`). Create also rejects a body
  `ownerAddress` that doesn't match the session (confused-deputy guard).
- **Crypto cleanups**: removed a dead/stale `titleKeyMessage()` + `TITLE_KEY_MESSAGE` from
  `lib/crypto.ts` (the live, single-source-of-truth message is in `lib/titleKey.ts`); added field
  validation to the IBE-header deserializer (`lib/threshold.ts`).

## Hardening since the review

- **CSP is now enforced** (`next.config.ts`). Shipped report-only, audited the production console for
  refusals across the wallet / Shelby WASM / drand / Supabase / font origins, then flipped the header
  to `Content-Security-Policy`. Caveat unchanged: the policy keeps `'unsafe-inline'` for Next's inline
  bootstrap (a strict `script-src` wants per-request nonces, which needs middleware), so its XSS value
  is partial. The app never injects raw HTML, so the practical XSS surface stays small.
- **Database: RLS closed and functions pinned** (migrations `0007`–`0009`), prompted by Supabase
  advisories:
  - `signer_keys` shipped in `0006` **without RLS** — readable and writable by anyone holding the
    project's anon key (`rls_disabled_in_public`, critical). RLS enabled in `0007`. All app access is
    service-role (which bypasses RLS), so this closed the hole with no functional change.
  - All five `public` functions had a **role-mutable `search_path`**, which lets a caller shadow
    unqualified object references. `0008` pins `search_path = ''` and schema-qualifies every table
    reference.
  - `0009` adds explicit `using (false)` deny policies for `anon`/`authenticated` on the four
    server-only tables (`recipient_secrets`, `signer_keys`, `signer_registrations`,
    `wallet_registrations`) — deny-all was already the effective state, this documents the intent.
  - Current live state: **7/7 public tables have RLS + at least one policy; 5/5 functions have a
    pinned `search_path`.**
- **Multi-network.** The app follows the connected wallet's network. Each safe records the network it
  was armed on (`drops.network`), and the contract address, Shelby endpoint, and API keys resolve per
  network (`lib/networks.ts`). Server-side release and retrieval use **the drop's stored network**, not
  a global — so a safe can only ever be released against the contract it was actually armed on. API
  keys are network-scoped by construction (a Shelbynet key 401s on Testnet), which removes the failure
  mode where a wrong-network key silently degrades a read to "empty" instead of erroring.
- **`POST /api/drops/[dropId]/reconcile`** (new, unauthenticated, same-origin only). It re-reads the
  on-chain release state and, if the threshold is met, emails recipients their one-time link. It is
  safe to expose: it only sends a notification the **on-chain release already permits**, returns no
  secret or link in its response, and is idempotent via `notifications_sent_at`. It cannot force a
  release. No owner session is required because signers aren't the owner.
- **Notifier no longer destroys retrieval material when email is off.** `lib/releaseNotify.ts` used to
  delete the one-time recipient secrets and mark the drop notified even when `RESEND_API_KEY` was
  unset, which permanently lost the retrieval link in any environment without email. It now only
  mutates that state when a send actually happened.

## Residual / known gaps (accepted or deferred)

1. **Transitive `uuid` advisory (8 × moderate).** Comes from `@aptos-connect/web-transport` →
   `@aptos-labs/wallet-adapter-core`. That chain is the **AptosConnect / keyless** path, which we
   deliberately exclude (`optInWallets={["Petra"]}`), so the vulnerable code never loads. The only
   `npm audit fix` downgrades the wallet adapter v8→v3 (breaking). Tracked upstream; re-check on
   adapter updates.
2. **Verifiable delivery / SRI** — the deployed frontend is trusted as served (no Subresource Integrity
   hashes, no reproducible-build attestation). This is the residual "frontend delivery trust" risk in a
   client-side-crypto app and a `CLAUDE.md` definition-of-done item still open. Mitigation path:
   reproducible build + published bundle hashes in a public log. Deferred.
3. **No rate limiting** on the unauthenticated public endpoints (`/api/public`, `/api/register*`,
   `/api/retrieve`, `/api/drops/[id]/reconcile`). The cryptographic gate is the real control (probing
   returns a uniform `410`), so this is operational hardening, not a confidentiality risk. `reconcile`
   is the one worth watching: it's same-origin but unauthenticated and does an on-chain read per call,
   so it's a cheap way to burn RPC quota. Add edge rate limiting (e.g. Upstash) before a public launch.
4. **Recipient slot binding** — wallet recipients are currently disabled (email recipients only), so
   the registration-slot-hijack concern is not live. Multisig **signer** slots are bound at arm time:
   `armDrop` rejects a registered signer whose wallet ≠ the owner-designated address.
5. **Same-origin check & previews** — because mutating routes require `Origin === NEXT_PUBLIC_APP_URL`
   (or localhost), creating/deleting safes works on the canonical domain (`untilthen.xyz`) and local
   dev, but **not** on Vercel preview URLs. Demo and test on the production domain. The Shelby and
   Aptos keys (one per network) are browser-side rate-limit keys, not secrets; they should each be
   created with an allowed-URL list of `untilthen.xyz` and "enforce origin" on, so a copied key is not
   usable from another site. **Verify this per key in the geomi.dev console** — it is not enforced by
   anything in this repo.
6. **Storage lifetime vs. release window — parked on purpose.** Shelby caps a blob at 48h today (was
   24h, expected to rise, no ETA), while a time-lock can be armed for months. There is deliberately no
   arm-date guardrail and no check-in-extends-storage renewal while the cap is still moving, and the
   project has no real users yet. The sharp edge to fix first when it settles: `lib/decrypt.ts` burns
   the one-time retrieval link **before** downloading the blob, so an expired blob consumes the link
   and loses the file permanently. This is an availability/data-loss risk, not a confidentiality one —
   nothing becomes decryptable that wasn't already.

## Operational notes

- Rotate `AUTH_SESSION_SECRET` to invalidate all sessions. Disconnecting the wallet clears the session
  client-side; the cookie expires after 7 days.
- The Shelby uploader key model is **not** used in production — uploads are signed and paid by the
  owner's own wallet (no server custody of storage funds).

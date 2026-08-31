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
- **SIWA sign-in** — Ed25519 signature verified, public-key→address binding checked (the address is
  re-derived from the pubkey, so pubkey substitution is rejected), 5-minute freshness window, JWT
  (HS256) in an `HttpOnly` + `Secure` cookie. **Correction (2026-08):** an earlier revision of this
  file claimed "app-name domain binding (can't replay a signature from another site)". That was wrong
  — no origin is requested from the wallet or verified server-side. See gap 7.
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
- **`POST /api/drops/[dropId]/reconcile`** (new, unauthenticated). It re-reads the on-chain release
  state and, if the threshold is met, emails recipients their one-time link. It is safe to expose: it
  only sends a notification the **on-chain release already permits**, carries no secret or link, and is
  idempotent via `notifications_sent_at`. It cannot force a release. No owner session is required
  because signers aren't the owner. Its response is **deliberately opaque (always `204`)** — see the
  next entry.
- **Closed an unauthenticated release-state oracle** (review finding). `reconcile` used to return
  `{released, emailsSent}`. Because `isSameOrigin` only checks the `Origin` header — trivially set by
  any non-browser client, and documented as CSRF defense-in-depth rather than authentication — that
  made release state readable by anyone holding a `dropId`, plus the recipient count from `emailsSent`.
  For a dead man's switch, "has this safe fired?" itself discloses that the owner stopped checking in,
  and it contradicted the uniform `410` that `/api/retrieve` returns precisely to deny that oracle. The
  route now always returns `204`, errors included.
- **Revoked the client-role database privileges the app never uses** (migration `0011`, review
  finding). `0003` revoked `SELECT` from `anon` but left the write privileges and function `EXECUTE`
  that Supabase's "auto-expose new tables" default grants, and never touched `authenticated` at all.
  Live state before the fix: `anon`/`authenticated` held `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
  TRIGGER` on all 7 tables and `EXECUTE` on all 5 RPCs via PostgREST with the *public* anon key, and
  `authenticated` additionally held full-table `SELECT` — including `recipient_secrets` (the one-time
  retrieval secrets) and every column of `drops`. All of it was denied, but by exactly two properties:
  the functions are `SECURITY INVOKER` (so their statements hit RLS as the caller) and
  `deaddrop_owner()` returns `NULL` for a client JWT. Marking any of those functions `SECURITY DEFINER`
  — the usual reflex when an RPC "doesn't work" under RLS — would have turned the public anon key into
  an authenticated writer (`rpc/mark_released` to force a release, `rpc/burn_recipient` to burn a
  link). `TRUNCATE` was worse in kind, since RLS covers only SELECT/INSERT/UPDATE/DELETE and is no
  backstop for it. `0011` revokes all of it, adds matching `alter default privileges` so new objects
  don't reintroduce it, and keeps `0003`'s deliberate 12-column anon `SELECT` on `drops`. Verified
  after: **zero table privileges for `anon`/`authenticated`, `service_role` untouched.**
- **The `?round=` release override is ignored in production** (review finding).
  `GET/POST /api/cron/release` accepted a caller-supplied drand round with no environment guard, and it
  feeds `findReleasableTimelockDrops`' `release_round <= currentRound`. One request with a huge round
  therefore matched **every unreleased time-lock safe at once**: marking them released, emailing every
  recipient their one-time link, burning those links (`deleteRecipientSecrets` wipes the material), and
  permanently refusing further resets (`resetTimelock` rejects a released drop) — the switch broken for
  everyone, unrecoverably. Confidentiality was never at risk (the shard stays drand-locked, so nothing
  decrypts before the real round publishes); this was integrity/availability. It needed `CRON_SECRET`,
  but that set is wider than it looks: `lib/qstash.ts` forwards the secret to Upstash on every
  scheduled release, so a third party holds it permanently. Production now always reads live drand;
  the override still works under test/dev. Both directions are pinned by
  `lib/__tests__/cron-round-guard.test.ts`.
- **The recipient-registration `GET` no longer returns the stored signature** (review finding). It
  returned `{registered, walletAddress, signature}` unauthenticated. Under the documented
  wallet-recipient design (`BUILDING.md`) the per-recipient wrap key is
  `deriveWalletWrapKey(signature over registerMessage(dropId))` — that signature *is* key material —
  and `dropId`/`recipientId` travel in retrieval URLs, so they aren't secret. Nothing was at risk
  (wallet recipients are refused at arm time, so no safe has ever wrapped `shardB` this way, and
  `deriveWalletWrapKey` is only ever called with owner-copy and signer-enc signatures, neither exposed
  anywhere), but implementing wallet recipients as documented would have shipped a decryption hole. No
  caller consumed the field; the response is now `{registered, walletAddress}`.
- **Owner-authorization signatures now expire** (review finding). `ownerAuthMessage(dropId)` was a
  constant string per safe and `verifyOwnerAuth` checked only the signature and the address — no nonce,
  no timestamp — so a signature captured once stayed valid forever. That mattered most at
  `POST /api/drops/[id]/reset`, which accepts `tlockShardA` as any non-empty string: replaying a
  captured signature there overwrites the drand-locked ciphertext with attacker-chosen bytes and moves
  the release date, i.e. destroys a safe (recipients get a link that no longer decrypts) or postpones
  the switch indefinitely — the exact failure this product exists to prevent. It also contradicted the
  "fresh per-action wallet signature" property claimed here and in `CLAUDE.md`, while `verifySiwa` had
  carried a freshness window all along. The challenge now embeds an `Issued:` timestamp, and
  `verifyOwnerAuth` rejects anything outside `OWNER_AUTH_MAX_AGE_MS` (10 minutes — wider than the SIWA
  window because `issuedAtMs` is stamped *before* the wallet prompt and one signature covers both
  requests of a reset flow). Safe to change because, unlike `ownerCopyMessage`, this string is never
  key material. Impact was integrity/availability only — no plaintext was ever reachable. Regression
  tests cover both a stale signature and a freshened-timestamp-with-old-signature forgery.
  *Not fixed:* `reset` still doesn't validate that the submitted `tlockShardA` is a well-formed tlock
  ciphertext for the claimed round — `tlock-js` exposes no public API to read the round back out, and
  hand-parsing the age format would be brittle. Freshness is the real control; this is defence in depth
  worth revisiting if the library gains a parser.
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
   is the one worth watching: it is effectively public (the `Origin` check is not authentication) and
   does an on-chain read per call, so it's a cheap way to burn RPC quota — it no longer leaks anything
   in its response, but it is still unmetered. Add edge rate limiting (e.g. Upstash) before a public
   launch.
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
6. **No origin binding on server-verified wallet signatures.** The app signs with
   `signMessage({ message, nonce })` and never requests the wallet's `application` field, so the
   signed `fullMessage` carries no origin and `verifyAptosSignedMessage` can only substring-match the
   challenge (`signedMessage.includes(mustContain)`). Nothing ties a signature to `untilthen.xyz`: a
   phishing dapp can present our exact challenge text (verbatim, with `nonce: "deaddrop"`, producing a
   byte-identical `fullMessage`), and the resulting signature is accepted by our server. Two uses — a
   harvested **SIWA** signature mints a session cookie for the victim's address (5-minute window),
   exposing their dashboard metadata (drop ids, modes, distributions, release dates, recipient counts;
   titles stay encrypted under a key that never reaches the server); a harvested **owner-auth**
   signature replays to `reset` on a known `dropId` (10-minute window). Not a plaintext exposure.

   Fix, deliberately staged rather than shipped blind: request `application: true` for auth signatures
   and verify the origin server-side (the wallet fills that field from the requesting origin, so it
   can't be forged). Two hazards make this need care —
   (a) **it must not touch the shared signing bridge.** `ownerCopyMessage` and `signerEncMessage`
   signatures are *key material*, consumed only client-side by `deriveWalletWrapKey` /
   `deriveSignerEncKeypair` and never sent to the server. Adding `application` to `signMessageFull`
   globally would change those signature bytes and break reset/recovery on every existing safe and
   every signer's ECIES keypair. It needs a second, auth-only bridge.
   (b) **Petra's exact `fullMessage` format must be confirmed first** (`application: untilthen.xyz`
   vs `application: https://untilthen.xyz`) — guessing wrong breaks sign-in for the live app.
   Step one is capturing one real `fullMessage` from Petra to pin the format.

7. **Storage lifetime vs. release window — parked on purpose.** Shelby caps a blob at 48h today (was
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

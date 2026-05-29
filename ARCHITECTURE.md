# DeadDrop — Architecture

Dead man's switch for sensitive data built on Shelby (decentralized hot storage), Aptos (on-chain conditions and audit trail), and drand timelock encryption (custodian-free time release).

---

## Core security principle

**The operator (us) must never, at any point in a drop's life, hold everything needed to decrypt it.** This is the single invariant the entire architecture is built to preserve. Every design decision below follows from it.

A file is encrypted with a key K. K is split so that decryption requires two independent halves:
- **shardB** — wrapped per recipient; only the recipient can unwrap it (via a URL-fragment secret they receive by email, or via their wallet signature).
- **shardA** — gated by the drop's release condition, and **custody of shardA is never in our hands**:
  - **Time-lock drops:** shardA is timelock-encrypted to a future drand beacon round. No party — not us, not the chain, not the recipient — can recover it until that round publishes. Pure cryptography, no custodian.
  - **Multisig drops:** shardA's release is gated by an on-chain Move contract that verifies the required signer approvals. We never hold a releasable copy.

The result: a full breach of our backend yields, at worst, recipient metadata and wrapped shards that cannot be unwrapped without material we never possess. There is no window — not before the trigger, not during, not ever — in which compromising our infrastructure lets an attacker read a user's file. This property holds from the first drop, by construction.

Our backend's only role is **notification** for private drops: watch for releases (beacon round reached, or contract release) and email recipients their retrieval links. For public drops the backend isn't even needed at retrieval — the page self-unlocks via drand or the contract directly. The backend is a mailman, never a vault.

---

## Open questions to resolve BEFORE building (do not assume)

These are integration unknowns the public Shelby docs do not settle. They do not affect the confidentiality design — only *who signs and pays for the upload*. Resolve each by inspecting the installed SDK's TypeScript types or by asking the Shelby team (early-access channel). Do not assume a direction.

**1. What signer does the Shelby upload accept?** Every public Shelby example fills the `useUploadBlobs`/`ShelbyClient` upload `signer` argument with `Account.generate()` — a raw in-memory Aptos keypair (private key held locally). It is **unverified** whether that `signer` parameter also accepts a wallet-adapter signing path (Petra's `signAndSubmitTransaction`) or strictly requires a private-key `Account`.

- A connected wallet gives you the user's **address** and the ability to **sign**, but never the **private key** — so you cannot construct a raw `Account` from Petra. There is no "get an Account from the wallet" bridge; that cannot exist.
- **If the SDK accepts a wallet signer** (abstract signer / `signAndSubmitTransaction`): the connected wallet signs uploads directly. Preferred, and how Aptos dApps normally work. No extra account, no key generation.
- **If the SDK requires a raw `Account`:** a website using Petra cannot drive the upload directly. Fallbacks, preferred first: (a) a wallet-signer adapter, if the SDK exposes a transaction-builder hook accepting an externally-signed tx; (b) a backend signing service that holds an Aptos account and submits the upload — the browser still encrypts, so plaintext/keys never leave the client; this is a *who-pays/submits* change, not a confidentiality change; (c) an app-managed Aptos account the user funds (worse UX).

Throughout, `uploadCiphertext({ signer, ... })` takes "the signer Shelby's SDK accepts." Determine which case applies before implementing the upload flow. The Shelby **mock** (CLAUDE.md Step 7) lets all other work proceed meanwhile.

**2. Is `@shelby-protocol/sdk` installable during early access, or mock-only for now?** If access-gated, build against the mock and swap in the real SDK when available.

---

## What it does

A user encrypts a file client-side, uploads the ciphertext blob to Shelby, and configures how it's released. Every drop has two independent settings:

**Condition** — what triggers release:
- **Time-lock**: the file becomes decryptable at a chosen future time unless the owner keeps resetting the timer. Enforced by drand timelock encryption — a public randomness beacon, not our servers. (Same mechanism as drand's own audited `timevault` dead-man's-switch.)
- **Multi-sig**: a threshold of trusted wallet addresses (e.g. 2-of-3) must approve on-chain before release. Enforced by a Move contract on Aptos.

**Distribution** — who can open it:
- **Private**: specific recipients. Each gets a one-time retrieval link by email; only that recipient can decrypt (via a per-recipient secret or their wallet). 
- **Public**: one shareable link the owner can post anywhere. Anyone holding it can decrypt once the condition is met — the "post on X, opens in 3 days" case.

In all cases decryption happens entirely in the recipient's browser. No server ever sees plaintext, and no server can produce the key.

---

## Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router), TypeScript | SSR for landing, CSR for app |
| Styling | Tailwind CSS + CSS custom properties | Design tokens from Claude Design output |
| Wallet – Aptos (required) | `@aptos-labs/wallet-adapter-react` + Petra | Aptos signer is required for Shelby uploads (payment + commitment) |
| Wallet – Solana (recipient-side only) | `@solana/wallet-adapter-react` + Phantom | Recipients can authenticate retrieval with any chain; uploads require Aptos |
| Wallet – EVM (recipient-side only) | wagmi + viem + MetaMask | Same as above |
| Storage | `@shelby-protocol/sdk` + `@shelby-protocol/react` | Hot decentralized blob storage; Aptos-native |
| Storage helper | `@tanstack/react-query` | Required peer dep for `@shelby-protocol/react` |
| Aptos signing | `@aptos-labs/ts-sdk` + wallet adapter | Wallet signs via `signAndSubmitTransaction`; we never hold the user's private key |
| Encryption | Web Crypto API (native browser) | AES-256-GCM, no external lib needed |
| Key splitting (2-of-2) | Pure XOR in `lib/crypto.ts` | K = shardA XOR shardB; zero deps |
| Threshold release (multisig) | Threshold BLS + IBE in `lib/contract.ts` | Same IBE primitive as timelock; signers are the authority. BLS12-381 (e.g. `@noble/curves`); group-key setup via `shamir-secret-sharing` (owner-dealt) |
| Time-lock release | `tlock-js` (drand) | Custodian-free IBE timelock of shardA/K; audited by Kudelski |
| Condition logic (multisig) | Move module on Aptos | Verifies BLS approval signatures; gates release |
| On-chain anchor | Move module on Aptos | Drop registry, ownership, audit trail — ships at launch |
| State (client) | Zustand | Lightweight, works well with wallet adapters |
| Backend database | Supabase (Postgres) | Drop metadata, recipients, wrapped shards, notifier state |
| Backend runtime | Next.js API routes + scheduled job | Notifier only — never holds releasable shardA |
| Email delivery | Resend | Transactional email; sends notification links on release |

**Important architectural note:** Shelby uploads require an Aptos signer because payment, blob commitment, and storage metadata all live on Aptos. The cross-chain "wallet flexibility" only applies to **recipient authentication** (a recipient on Solana can prove identity to claim a multi-sig approval slot). All actual blob writes go through Aptos. This is reflected at launch by only enabling Petra; the others are UI-disabled placeholders.

---

## Repository structure

```
deaddrop/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout, providers
│   ├── page.tsx                  # Landing
│   ├── dashboard/
│   │   └── page.tsx              # Drops list + stats
│   ├── new/
│   │   ├── layout.tsx            # Multi-step shell
│   │   ├── encrypt/page.tsx
│   │   ├── condition/page.tsx
│   │   └── confirm/page.tsx
│   ├── drop/
│   │   └── [id]/page.tsx         # Drop detail + timer reset
│   ├── r/
│   │   └── [dropId]/[recipientId]/page.tsx   # Private recipient retrieval (4 path combos)
│   ├── p/
│   │   └── [dropId]/page.tsx                  # Public retrieval — self-unlocks via drand/contract
│   ├── register/
│   │   └── [dropId]/[recipientId]/page.tsx   # Wallet recipient pre-registration
│   ├── register-signer/
│   │   └── [dropId]/[signerId]/page.tsx      # Multisig signer pre-registration (BLS group key)
│   ├── approve/
│   │   └── [dropId]/[signerId]/page.tsx      # Multisig signer approval (decrypt + publish share)
│   ├── security/
│   │   └── page.tsx             # Security model / threat model in plain language
│   └── api/
│       ├── drops/
│       │   ├── route.ts          # POST: create drop (metadata + gated key refs + recipients)
│       │   └── [dropId]/reset/route.ts  # POST: atomic timer reset (timelock)
│       ├── retrieve/
│       │   └── [dropId]/[recipientId]/route.ts  # GET: private retrieval, burns link
│       ├── public/
│       │   └── [dropId]/route.ts  # GET: public drop metadata (releaseRound, blobName) — no burn
│       ├── register/
│       │   └── [dropId]/[recipientId]/route.ts  # POST: stores wallet recipient registration sig
│       ├── register-signer/
│       │   └── [dropId]/[signerId]/route.ts     # POST: stores signer BLS pubkey (group key)
│       └── cron/
│           └── release/route.ts  # scheduled: confirms drand round / contract release, emails private recipients
│
├── components/
│   ├── ui/                       # Primitive components
│   ├── wallet/
│   │   ├── WalletProvider.tsx
│   │   ├── ConnectModal.tsx
│   │   └── FundingModal.tsx
│   ├── drops/
│   │   ├── DropRow.tsx
│   │   ├── Countdown.tsx
│   │   ├── StatusChip.tsx
│   │   └── RecipientForm.tsx     # Email vs wallet toggle + fields
│   └── layout/
│       ├── Topbar.tsx
│       ├── Footer.tsx
│       └── Steps.tsx
│
├── lib/
│   ├── crypto.ts                 # Encryption, XOR, HKDF, fingerprint
│   ├── timelock.ts               # drand tlock-js wrapper (time-lock shardA gating)
│   ├── contract.ts               # Move client + threshold BLS/IBE for multisig + audit anchor
│   ├── shelby.ts                 # Shelby SDK wrapper
│   ├── aptos.ts                  # Aptos client + wallet signing + signature verification
│   ├── funding.ts                # Balance checks + faucets
│   ├── ids.ts                    # ID generation, formatters
│   ├── db.ts                     # Supabase client + queries
│   ├── email.ts                  # Resend client + template rendering
│   └── email-templates/
│       ├── recipient-email.tsx   # React Email: email recipients (secret-in-fragment link)
│       ├── recipient-wallet.tsx  # React Email: wallet recipients (sign to retrieve)
│       ├── signer-register.tsx   # React Email: ask a multisig signer to register
│       └── signer-approve.tsx    # React Email: ask a multisig signer to approve a release
│
├── contracts/
│   └── deaddrop/                 # Move module (ships at launch)
│       ├── sources/
│       │   └── DeadDrop.move
│       └── Move.toml
│
├── store/
│   ├── drops.ts                  # Zustand store (client-side cache of own drops)
│   └── wallet.ts                 # Zustand store (connected wallet address/chain/name)
│
├── supabase/
│   └── migrations/
│       └── 0001_initial.sql      # drops, recipients, recipient_secrets, signers tables
│
├── types/
│   └── index.ts                  # Shared TypeScript types
│
└── styles/
    └── globals.css               # Design tokens
```

---

## Data model

```typescript
// Each recipient is one of two types:
// - "email"  — gets a URL with a secret in the fragment; no wallet required
// - "wallet" — must connect a wallet and sign to derive their shard
type RecipientType = "email" | "wallet"

type Recipient = {
  id: string                    // "rcpt_" + 8 hex chars, used in retrieval URLs
  name: string                  // owner-facing label (optional)
  type: RecipientType

  // Primary email is REQUIRED for both types — that's how they're notified.
  // Stored ENCRYPTED at rest (encrypted_email); decrypted only by the notifier at send time.
  email: string                 // plaintext in the owner's browser; ciphertext in the DB

  // Optional backup email — gets the same notification if primary fails or is missed.
  // Also stored encrypted at rest.
  backupEmail?: string

  // Wallet recipients only: the wallet they must sign with to retrieve
  walletAddress?: string
  walletChain?: "aptos" | "solana" | "ethereum"

  // Encrypted shardB material — populated at drop creation time.
  // For "email" recipients:  shardB XOR HKDF-Expand(recipientSecret, "deaddrop-shardB", 32)
  //                          where recipientSecret is delivered via URL fragment in the email
  // For "wallet" recipients: shardB XOR SHA-256(registrationSignature)
  //                          where registrationSignature comes from pre-registration step
  wrappedShardB: string         // base64

  // Server-side single-use flag. Set when the recipient first successfully retrieves.
  // Subsequent attempts return 410 Gone.
  releasedAt: number | null     // epoch ms
}

// A "Drop" is the core entity
type Drop = {
  id: string                    // "drop_" + 8 hex chars
  title: string                 // owner-facing label; held in plaintext only in the owner's
                                //   browser. Stored as encryptedTitle (client-encrypted under the
                                //   owner key); the backend never sees the plaintext. See metadata minimization.
  blobName: string              // Shelby blob name (we set this at upload: `deaddrop_${id}`)
  iv: string                    // base64 IV used for AES-GCM
  ciphertextFingerprint: string // SHA-256 of ciphertext, formatted as hex groups

  // CONDITION type — how the gated secret is released
  mode: "timelock" | "multisig"
  // DISTRIBUTION type — who can open it and how the link works
  distribution: "private" | "public"
  status: "armed" | "released" | "expired"
  expirationMicros: number      // Shelby blob expiration

  // "Gated secret" = shardA for private drops, or K itself for public drops.
  // How it's gated depends ONLY on `mode`:

  // timelock mode: the gated secret is timelock-encrypted to a drand round.
  tlockShardA?: string          // tlock-js ciphertext of (shardA | K). base64/armored.
  releaseRound?: number         // the drand round it unlocks at

  // multisig mode: the secret is IBE-encrypted to identity = dropId, with the drop's signer
  // group as the threshold authority (same primitive as timelock, different authority).
  // Decryptable once `threshold` signers publish BLS signature shares over dropId on-chain.
  contractRef?: string          // on-chain drop record (group key, enc'd key shares, IBE header, sig shares)
  ibeHeader?: string            // base64: IBE ciphertext header (the secret encrypted to dropId)
                                //   mirror of tlockShardA but for the signer-group authority

  // Owner's wrapped copy of the gated secret, for TIMELOCK timer resets only.
  // Useless without the owner's wallet signature on `deaddrop:owner:${id}`.
  // Set for timelock drops (private → ownerShardA, public → ownerKeyWrapped) unless the
  // owner chose "no owner copy". NEVER set for multisig drops (owner must not open alone).
  ownerShardA?: string          // base64 (private timelock)
  ownerKeyWrapped?: string      // base64 (public timelock)

  // Time-lock fields
  checkInIntervalDays?: number
  gracePeriodDays?: number
  triggerAt?: number            // epoch ms — the chosen release time (maps to releaseRound)

  // Multi-sig fields. Each signer has an Aptos address AND a BLS public key (their share of
  // the group key, established at signer pre-registration) used to verify their approval
  // signature on-chain. The group public key, encrypted key shares, and IBE header live ON-CHAIN.
  signers?: { name?: string; address: string; blsPubkey: string; registered: boolean }[]
  threshold?: number
  approvals?: number            // cached count of on-chain approvals, for dashboard display

  // PRIVATE drops only: specific recipients with per-recipient wrapped shardB.
  // PUBLIC drops have an empty recipients array.
  recipients: Recipient[]

  // Notifier state. For private drops, set when emails are dispatched.
  // For public drops, set for dashboard status only — the /p page self-unlocks.
  releasedAt: number | null     // epoch ms — when the condition was observed met
  notificationsSentAt: number | null

  ownerAddress: string          // Aptos address of the drop creator
  created: number               // epoch ms
}

// What the owner's wallet signs to prove "I'm still here"
type CheckInPayload = {
  dropId: string
  timestamp: number
  action: "checkin"
}
```

**Two independent axes.** A drop has a *condition* (`mode`: timelock or multisig) and a *distribution* (`distribution`: private or public). Not all four combinations are offered:
- `private + timelock` — specific people, opens at a time. ✓
- `private + multisig` — specific people, opens on approvals. ✓
- `public + timelock` — anyone with the link, opens at a time. ✓ (the "post on X" case)
- `public + multisig` — anyone with the link, opens on approvals. ✓ (e.g. "released when 2 of 3 board members sign")

The public/multisig combination is valid and useful, but verify the UX makes sense before exposing it; public/timelock is the headline public mode.

**Important semantic distinction between the two conditions:**
- **Timelock is a true dead-man's switch**: release is automatic and adversarial-to-inaction. The owner does nothing and it fires; the owner checks in to *prevent* firing. No one needs to act for release to happen.
- **Multisig is threshold-authorized release**, which is a different shape: release requires designated signers to *actively approve*. Nothing fires on its own. This fits "release my files if 2 of 3 trusted people agree the time has come" (e.g. they agree the owner has died, or a board authorizes disclosure). It does **not** provide automatic release if everyone is inactive — if signers never approve, a multisig drop never opens.

This distinction must be clear in the UI. A user wanting "released automatically if I disappear" needs timelock. A user wanting "released when my trusted people decide" needs multisig. A user wanting *both* ("auto-release after 1 year, OR sooner if 2 of 3 approve") needs a combination we do **not** offer at launch — note it as a future "hybrid condition" feature rather than implying multisig alone is a dead-man's switch. Signers in a multisig drop are notified by email that their approval is being requested (the owner or any party can trigger the approval-request notification); they are not expected to monitor anything continuously.

**Key properties of this model:**
- A drop has a *condition* (timelock/multisig) and a *distribution* (private/public), set independently
- Private drops have recipients, each with their own `wrappedShardB` and `releasedAt` flag; shardB is per-recipient
- Public drops have no recipients and no shardB — the whole key K is timelock-encrypted; anyone with the link decrypts after release
- shardA (private) or K (public) is gated by drand (timelock) or the Move contract (multisig)
- The backend never stores a raw shardA or raw K — only timelock ciphertext (drand-locked), `contractRef` (chain-held), or wallet-wrapped owner copies
- Single-use enforcement (private drops) lives in each recipient's `releasedAt`; public drops are intentionally not single-use

---

## Encryption architecture

### The core idea

A file is encrypted once with a random AES-256-GCM key K. For **private drops**, K is split into two halves via XOR:

```
K = shardA XOR shardB
```

For **public drops** there is no shardB and no recipients — the whole key K plays the role of "shardA" and is gated directly (timelock-encrypted, or threshold-wrapped on-chain). Everywhere below that says "shardA," read it as "K itself" for public drops. The gating mechanism is identical; only the per-recipient shardB layer is absent.

- **shardA** is shared across all recipients and gated by the drop's release condition. For time-lock drops it is timelock-encrypted to a future drand round (no custodian). For multisig drops it is IBE-encrypted to identity = dropId under the signer group's key — recoverable only once a threshold of signers publish approval signatures (never stored raw on-chain — see Aptos/Move section). It is never stored raw by our backend.
- **shardB** (private drops only) is **per-recipient** and never stored in usable form. For each recipient we compute a `wrappedShardB` that can only be unwrapped by something only that recipient possesses.

What "something only that recipient possesses" means depends on the recipient type:
- **Email recipient**: a 32-byte secret embedded in the URL fragment of the notification email
- **Wallet recipient**: a deterministic signature from the recipient's wallet on a fixed message

Either way: shardB never sits on a server or on-chain in unwrapped form. The wrapping is only undone in the recipient's browser at retrieval time.

### How shardA is gated — the two condition types

shardA is the same 32 random bytes in both cases (`shardA = K XOR shardB`). What differs is how it's protected until release.

**Time-lock drops — drand timelock encryption.**

We don't store shardA. We *timelock-encrypt* it to a future drand beacon round, using `tlock-js`, and store only that timelock ciphertext (`tlockShardA`).

```
releaseRound = drandRoundForTime(triggerAt)         // map a wall-clock time to a beacon round
tlockShardA  = tlock_encrypt(shardA, releaseRound)   // tlock-js, in the owner's browser
// store tlockShardA; discard shardA
```

`tlock_encrypt` produces a ciphertext that is mathematically impossible to decrypt until the drand network publishes the signature for `releaseRound`. The drand mainnet timelock network is production-ready, run by the League of Entropy that has operated drand since 2019. When that round publishes, *anyone* can decrypt `tlockShardA` back to `shardA` — but `shardA` alone is useless without each recipient's `shardB`, which only the recipient can unwrap. So the file still only opens for the right recipient, and only at/after the chosen time.

No custodian holds shardA. Not us, not the chain, not drand (it only publishes randomness; it never sees your data). If our entire backend is breached the day before release, the attacker gets `tlockShardA` — which they cannot decrypt until the round publishes, exactly like everyone else.

**Timer resets:** "I'm still here" means re-timelocking to a later round. When the owner checks in, the browser re-encrypts shardA to a new, later `releaseRound` and replaces `tlockShardA`. (This requires the owner to still have shardA available — see "Owner key custody" below.)

**Multisig drops — threshold BLS / IBE (same primitive as timelock).**

We don't store shardA, and the contract never holds it either. shardA is **IBE-encrypted to identity = `dropId`** under the drop's signer-group BLS public key (the same IBE operation tlock uses, with signers as the authority instead of drand). We store only that IBE ciphertext header (`ibeHeader`). A signer approves by publishing a BLS signature share over `dropId`; once a threshold of shares exists on-chain, anyone aggregates them into the IBE decryption key and recovers shardA via the same IBE decrypt as timelock. drand can express "time passed" but not "people approved," so the signer group is the authority here — but the cryptographic machinery is identical. The full construction (group-key setup, what's on-chain, why nothing leaks early) is in the Aptos/Move section.

In both cases the backend's knowledge is the same: it knows `tlockShardA` (time-lock) or `ibeHeader` + a contract reference (multisig), plus per-recipient `wrappedShardB` and email secrets. **None of these combine into a key without the missing element** — the published beacon round, or the threshold of signer signatures, or the recipient's unwrap material. There is no point in the drop's life where our infrastructure holds everything needed to decrypt.

### Per-recipient shardB wrapping

shardB is generated fresh per drop (random 32 bytes) and wrapped per recipient with something only that recipient can reproduce:

```
For each recipient i:
  IF type == "email":
    secret_i      = 32 random bytes
    wrap_key_i    = HKDF-Expand(secret_i, "deaddrop-shardB", 32)
    wrappedShardB_i = shardB XOR wrap_key_i
    // secret_i is delivered to the recipient via the URL fragment in the email,
    // then deleted from the backend. The backend never keeps secret_i long-term.
  IF type == "wallet":
    // recipient pre-registered, producing a deterministic signature reg_sig_i
    wrap_key_i      = SHA-256(reg_sig_i)
    wrappedShardB_i = shardB XOR wrap_key_i
    // nothing stored that reproduces the wrap key — recipient re-signs at retrieval
```

**Why this is safe to store:** `wrappedShardB_i` reveals nothing without `wrap_key_i`, and `wrap_key_i` requires either the email secret (which lives in the recipient's inbox after delivery) or the recipient's wallet signature. The wrap key is never derived from anything public.

**Deterministic signatures (wallet path):** the recipient must produce the same signature at registration and retrieval. Ed25519 (Aptos, Solana) and ECDSA-RFC6979 (Ethereum) are all deterministic, so this holds across chains. A unit test asserts signature stability as a guard against wallet-adapter changes.

### Owner key custody (so resets and the owner's own access work)

There's one subtlety to handle: for **time-lock resets**, the owner needs the gated secret again later to re-timelock it. (For private drops the gated secret is shardA; for public drops it is K itself.) We don't want to store it raw (that would reintroduce a custodian).

Solution: wrap a copy of the gated secret for the owner, under a key derived from the owner's wallet signature:

```
ownerWrapKey = SHA-256(owner_wallet.sign("deaddrop:owner:${dropId}"))

// private drops:
ownerShardA     = shardA XOR ownerWrapKey       // stored as drops.owner_shard_a
// public drops:
ownerKeyWrapped = K       XOR ownerWrapKey       // stored as drops.owner_key_wrapped
```

At reset time the owner's browser signs the same message, recovers shardA (or K), picks a new `releaseRound`, recomputes `tlockShardA`, and updates the drop. The wrapped copy is safe to store because it requires the owner's wallet signature to unwrap — the backend can't use it. This keeps the operator out of custody while letting the owner manage the timer.

(For timelock drops, store the owner copy so the owner can reset the timer and self-recover. **Multisig drops get no owner copy** — see the Aptos/Move section; the owner deliberately cannot reconstruct alone, which is the point of multisig.)

**Honest caveat about the owner copy (timelock drops):** because `ownerKeyWrapped`/`ownerShardA` lets the owner reconstruct the secret at any time with only their wallet, the owner can always decrypt their own *timelock* drop regardless of the clock. This is correct for a dead-man's-switch (the owner had the plaintext to begin with). If a use case requires that *even the owner* cannot retrieve early — a true commitment — offer a "no owner copy" option that omits the owner-wrapped field, at the cost of losing timer-reset ability (the drop becomes fire-once at its original round). Multisig drops are inherently in this category: no owner copy, owner cannot open alone. Default timelock drops to keeping the owner copy; document the tradeoff.

### Reset semantics and the irreversibility edge

Resetting only works **while you are ahead of the round.** A timelock ciphertext is bound to round R. Reset re-binds to a later round R' and replaces the stored ciphertext. As long as the owner checks in before R is reached, the lock keeps moving into the future and the file never opens.

The hard rule: **once round R publishes, the drop has fired — irreversibly.** drand cannot un-publish a round. A ciphertext encrypted to a passed round is decryptable by anyone who holds it, forever. There is no reset after that point. For private drops this only exposes the file to the intended recipients (they still need their shardB), which is the desired trigger behavior. For public drops it means immediate public disclosure (see below).

Three implementation requirements follow:

1. **Atomic reset.** The reset endpoint must write the new `tlockShardA` + `releaseRound` (+ `ownerKeyWrapped`/`triggerAt`) in a single transaction. Never leave a state where the old and new ciphertexts are both "live" or neither is. Use an optimistic-concurrency guard: `UPDATE ... WHERE id = ? AND release_round = <expected_old_round>` so two concurrent resets can't interleave.

2. **Early warnings, generous grace.** The grace period and check-in reminders must fire days before the round, never minutes. The race window between "decide to reset" and "new ciphertext committed" is seconds; the check-in interval is days — keep that ratio enormous. Surface "your drop goes live in X days unless you check in" prominently.

3. **No reset offered once `triggerAt` has passed.** The UI must hide/disable reset for a drop whose round has published and reflect `status: "released"`.

### Public drops ("post the link, it opens later")

A **public drop** is for openly shareable links: *"In 3 days, proof drops here: deaddrop.app/p/abc123."* Anyone holding the link can decrypt once the condition is met; before then, nobody can — including the owner and us.

How it differs from private drops:

- **No shardB, no recipients.** The whole key K is gated directly by the condition. For a public **timelock** drop: `tlockShardA = tlock_encrypt(K, releaseRound)` — the field holds tlock(K). For a public **multisig** drop: `ibeHeader` holds the IBE encryption of K to identity=dropId under the signer group. (Public just means "K is gated, no per-recipient shardB layer" — the gating mechanism is the same as private.)
- **The link carries `dropId` + `blobName` only — no secret.** Anyone with it can, after release, fetch the ciphertext from Shelby, obtain the release material (drand round signature for timelock, or aggregated signer signature shares for multisig), recover K, and decrypt. All client-side.
- **The retrieval page self-unlocks.** Before release: shows a live countdown (timelock) or approval progress (multisig). After: decrypts and offers the download. No email, no notifier involvement — the page checks drand or the contract directly.
- **Not single-use.** By definition anyone can open it after release, repeatedly. There is no burn.
- **Resets** (timelock only) work the same way (re-timelock K via `ownerKeyWrapped`), with the same irreversibility edge — but sharper, because a passed round means *the world* can open it, not just intended recipients. (Public multisig has no timer to reset.)

**Security posture (this is the purest version of the product):** for a public timelock drop, our backend is not even required for retrieval. The ciphertext is on Shelby, the unlock is drand math, the decryption is in the browser. We could go fully offline and a public drop would still open on schedule. That's the strongest possible trust story — we are irrelevant to its security.

**The consequences the UI must make violently clear:**

- **The link is the whole credential.** Whoever holds it opens the file after release. Share it as publicly or privately as you intend the *result* to be.
- **No take-backs once shared.** You can delay release by checking in (resetting the round), but you cannot un-publish a link already posted to X. If the round fires, it opens, and the link is already out there.
- **"Public" ≠ "private link I happen to share."** A user must not pick public thinking it stays private. The creation flow needs an explicit, friction-ful confirmation: *"Anyone who gets this link will be able to open the file after [date]. This cannot be undone once you share it."*

**What a public timelock proves, and what it doesn't:** it proves *commitment time* — the ciphertext is fixed and bound to a round, so you demonstrably committed to this exact content before the release date and couldn't alter it afterward. It does **not** prove the content is true, nor that you didn't prepare other contradictory drops. It's a commitment/disclosure mechanism, not a truth oracle. The security page should state this so users don't over-claim ("proof" in the colloquial sense, not cryptographic proof of truth).

### Wallet recipient pre-registration

A wallet recipient must register once before the owner arms the drop, so the owner can compute that recipient's `wrappedShardB`:

1. Owner enters the recipient as type "wallet" with their email + wallet address, clicks "Send registration link"
2. Backend creates a pending recipient row, emails a registration link
3. Recipient opens `/register/[dropId]/[recipientId]`, connects wallet, signs `deaddrop:register:${dropId}`
4. Browser submits the signature to `POST /api/register/...`; backend verifies it against the wallet address on the appropriate chain and stores it
5. Owner sees "registered" status; can now arm. The owner's browser fetches the registration signatures, computes each `wrappedShardB` via `deriveWalletWrapKey`, and uploads.

The signature is not secret — it only becomes a wrap key when SHA-256'd, and even then it wraps shardB, which is useless without shardA. `dropId` is allocated client-side at the start of the flow so it exists before registration. Abandoned registrations are garbage-collected after 30 days.

**Signers vs recipients — distinct roles in a multisig drop.** *Recipients* receive the file; *signers* approve release. They may overlap but are configured separately. For a multisig drop, each **signer** must also pre-register — establishing a **BLS key share** of the signer-group key (not just a signature), because their approval is a BLS signature share over `dropId` that the contract verifies and that aggregates into the IBE decryption key (see Aptos/Move section). The owner cannot arm a multisig drop until all signers have registered. A private multisig drop therefore has two pre-registration gates: recipients (for shardB) and signers (for the threshold-IBE authority).

### Why XOR for the 2-of-2 split (and how multisig differs)

For the K = shardA XOR shardB split (private drops), XOR is exactly 2-of-2 Shamir — simpler, zero deps, native Web Crypto. We use XOR there.

**Multisig does not use Shamir-over-an-unwrap-key.** It uses **threshold BLS / IBE** — the same primitive as timelock — where the secret is IBE-encrypted to identity=`dropId` and `t` signer BLS signature shares aggregate into the decryption key. Setting up the signer group key does involve splitting a BLS secret key across signers (owner-dealt Shamir at launch, or DKG later), but the release mechanism is signature aggregation, not share reconstruction of an XOR pad. This keeps one IBE decrypt path shared with timelock. See the Aptos/Move section.

### Flow: condition is met and recipient retrieves

**Time-lock drop, email recipient:**

```
1. The drand round for the drop's release time publishes (public event, no action by us)
2. Our notifier (scheduled job) notices the round has passed for drops not yet notified
3. For each email recipient: build URL with secret in fragment, send email, delete secret
4. Recipient opens https://deaddrop.app/r/${dropId}/${recipientId}#${secret}
5. Browser reads secret from window.location.hash (never sent to a server)
6. Browser calls GET /api/retrieve/... → server returns
   { wrappedShardB, tlockShardA, iv, blobName, fingerprint, releaseRound }
   and atomically burns the link (releasedAt = now())
7. Browser fetches the drand round signature for releaseRound (from a drand HTTP endpoint)
8. Browser tlock-decrypts tlockShardA → shardA
9. Browser unwraps: shardB = wrappedShardB XOR HKDF(secret); K = shardA XOR shardB
10. Browser downloads ciphertext from Shelby, verifies fingerprint
11. Browser AES-GCM-decrypts → plaintext → triggers download
12. Link is burned; refresh yields 410 Gone
```

**Multisig drop, wallet recipient:**

```
1. Designated signers each publish a BLS signature share over `dropId` via approve_release,
   until threshold is reached
2. The Move contract marks released == true; the signature shares are now on-chain
3. Our notifier sees release, emails recipients (wallet path: no secret in URL)
4. Recipient opens the link, connects wallet, signs deaddrop:register:${dropId}
5. Browser calls GET /api/retrieve/... → returns { wrappedShardB, ibeHeader, iv, blobName,
   fingerprint, contractRef } and burns the link
6. Browser reads the published BLS signature shares from the contract, aggregates t of them
   into the IBE decryption key for identity=dropId, and IBE-decrypts ibeHeader → shardA.
   (Same IBE decrypt routine as timelock; only the key source differs.) shardA never existed
   on-chain; only sub-threshold signature shares did, which reveal nothing.
7. Browser unwraps shardB with the signature, combines to K, decrypts, downloads
```

Note: the chain never holds shardA or the IBE decryption key. Reading chain state before `threshold` signers sign yields the IBE header (undecryptable without the identity key) and sub-threshold BLS shares (which reveal nothing).

Mixed drops (time-lock with both email and wallet recipients) work too: the secret's gating is per-drop (drand or signer group), the unwrapping of shardB is per-recipient (secret or signature).

**Public drop (anyone with the link):**

```
1. Owner posts the link anywhere: https://deaddrop.app/p/${dropId}
2. Anyone opens it. Page fetches drop metadata (releaseRound, blobName, mode).
3. Before release:
   - timelock: page computes time-to-round and shows a live countdown
   - multisig: page reads approvals from the contract and shows progress
4. After release:
   - Browser fetches the ciphertext from Shelby by blobName
   - timelock: fetch the drand round signature, tlock-decrypt tlockShardA → K
     multisig: read the published BLS signature shares from the contract, aggregate t of them
     into the IBE key for identity=dropId, IBE-decrypt the header → K. (For public drops the
     gated secret IS K — no shardB.)
   - Browser verifies fingerprint, AES-GCM-decrypts, offers download
5. No burn, no email, no recipient identity. The page self-unlocks via drand/contract.
   The backend is not required for step 4 at all.
```

### Single-use enforcement (private drops only)

Single-use applies to **private** drops. Public drops are intentionally multi-use — anyone with the link can open after release, repeatedly. The layers below describe the private flow.

**Layer 1 — server-side burn.** `GET /api/retrieve/[dropId]/[recipientId]` atomically checks `releasedAt IS NULL`, returns the payload, and sets `releasedAt = now()` in one SQL statement. Second call → 410 Gone.

**Layer 2 — time-bounded.** Each private link expires 7 days after release. After that, 410 regardless of burn state. (Public links have no expiry — they remain openable after release by design.)

**Layer 3 — client warning.** Prominent banner + acknowledgement checkbox before decryption: this is a one-time link, save the file now.

**What can't be enforced:** the recipient screenshotting, re-saving, or forwarding the decrypted file. The recipient is trusted by definition. We protect against link reuse, theft, and resurfacing — not against the legitimate recipient themselves.

Note that the burn is a *convenience and anti-resurfacing* control, not the core security boundary. Even without it, a private retrieval still requires the recipient's unwrap material; the burn limits link reuse and shrinks the window for a stolen link.

```typescript
// lib/crypto.ts

const REGISTER_MESSAGE_PREFIX = "deaddrop:register:"

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  )
}

export async function encryptBytes(
  plaintext: ArrayBuffer,
  key: CryptoKey
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const buffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  return { ciphertext: new Uint8Array(buffer), iv }
}

export async function decryptBytes(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey
): Promise<Uint8Array> {
  const buffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  return new Uint8Array(buffer)
}

export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key))
}

export async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
  )
}

// 32-byte XOR — used everywhere we wrap or unwrap a shard
export function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error("length mismatch")
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]
  return out
}

// Generate random bytes (used for shardB, per-recipient secrets, IVs)
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

// HKDF-Expand using Web Crypto: turns a secret into a fixed-length key
export async function hkdfExpand(
  secret: Uint8Array,
  info: string,
  outputBytes: number
): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    ikm,
    outputBytes * 8
  )
  return new Uint8Array(bits)
}

// Wallet path: derive the unwrap key from a registration signature
export async function deriveWalletWrapKey(
  signature: string
): Promise<Uint8Array> {
  const sigBytes = new TextEncoder().encode(signature)
  const hash = await crypto.subtle.digest("SHA-256", sigBytes)
  return new Uint8Array(hash)
}

// Build the registration message a wallet recipient signs
export function registerMessage(dropId: string): string {
  return `${REGISTER_MESSAGE_PREFIX}${dropId}`
}

export async function fingerprintOf(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data)
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
  // Format as 4 groups of 8 chars: "3f2a9c81 b9d4e5f6 a7c8b9d0 e1f2a3b4"
  return hex.match(/.{1,8}/g)!.slice(0, 4).join(" ")
}
```

### Timelock layer (`lib/timelock.ts`)

A thin wrapper over `tlock-js` (drand's audited TypeScript timelock library). Keep it separate from `lib/crypto.ts` so the drand dependency is isolated.

```typescript
// lib/timelock.ts
import { timelockEncrypt, timelockDecrypt, mainnetClient, roundAt } from "tlock-js"

// drand mainnet timelock chainhash (G1 sigs, 3s frequency) — verify current value at
// https://docs.drand.love before shipping; it is published in drand docs.
const client = mainnetClient()

// Map a wall-clock release time to a drand round number
export function roundForTime(releaseAtMs: number): number {
  return roundAt(releaseAtMs, client)
}

// Timelock-encrypt shardA so it can only be recovered once `round` publishes.
// Returns an armored string we store as tlockShardA.
export async function timelockEncryptShardA(
  shardA: Uint8Array,
  round: number
): Promise<string> {
  return timelockEncrypt(round, Buffer.from(shardA), client)
}

// Recover shardA. Throws if the round hasn't published yet (file still locked).
export async function timelockDecryptShardA(
  tlockShardA: string
): Promise<Uint8Array> {
  const plaintext = await timelockDecrypt(tlockShardA, client)
  return new Uint8Array(plaintext)
}
```

`tlock-js` was security-audited by Kudelski in 2023. It performs hybrid encryption (the payload is symmetric-encrypted; only a small key is timelock-wrapped), so encrypting a 32-byte shardA is cheap. Browser usage is supported (drand's own `timevault` app does exactly this in-browser).

### Upload flow as actual code

```typescript
// At drop creation, in the owner's browser:

async function armDrop(args: {
  file: File
  distribution: "private" | "public"
  recipients: RecipientInput[]   // private only; empty for public
  dropId: string
  mode: "timelock" | "multisig"
  releaseAtMs?: number           // timelock only
  ownerSignFn: (msg: string) => Promise<string>
  walletSigner: ShelbySigner     // connected wallet's signer for the Shelby upload (see Open questions)
  contractClient?: MoveContractClient  // multisig only
}) {
  const { file, distribution, recipients, dropId, mode } = args

  // 1. Encrypt the file
  const plaintext = await file.arrayBuffer()
  const key = await generateKey()
  const { ciphertext, iv } = await encryptBytes(plaintext, key)
  const fingerprint = await fingerprintOf(ciphertext)
  const keyBytes = await exportKey(key)

  // 2. Determine what gets gated:
  //    - PRIVATE: split into shardA (gated) + shardB (per-recipient). Gate shardA.
  //    - PUBLIC:  no shardB. Gate the whole key K directly.
  let shardB: Uint8Array | undefined
  let toGate: Uint8Array
  if (distribution === "private") {
    shardB = randomBytes(32)
    toGate = xorBytes(keyBytes, shardB)   // shardA
  } else {
    toGate = keyBytes                      // gate K itself
  }

  // 3. Gate `toGate` by condition type — operator NEVER receives it raw
  let tlockShardA: string | undefined     // holds tlock(shardA) or tlock(K)
  let contractRef: string | undefined
  let releaseRound: number | undefined
  if (mode === "timelock") {
    releaseRound = roundForTime(args.releaseAtMs!)
    tlockShardA = await timelockEncryptShardA(toGate, releaseRound)  // lib/timelock.ts
  } else {
    contractRef = await args.contractClient!.createDrop({ dropId, secret: toGate /* signers, threshold */ })
  }

  // 4. Wrap a copy of `toGate` for the OWNER (enables timer resets without operator custody)
  const ownerWrapKey = await deriveWalletWrapKey(await args.ownerSignFn(`deaddrop:owner:${dropId}`))
  const ownerWrapped = xorBytes(toGate, ownerWrapKey)  // → ownerShardA (private) or ownerKeyWrapped (public)

  // 5. PRIVATE only: wrap shardB per recipient
  const wrappedRecipients = distribution === "private"
    ? await Promise.all(recipients.map(async (r) => {
        if (r.type === "email") {
          const secret = randomBytes(32)
          const wrapKey = await hkdfExpand(secret, "deaddrop-shardB", 32)
          return { ...r, wrappedShardB: xorBytes(shardB!, wrapKey), secret }
        } else {
          if (!r.registrationSignature) throw new Error("Wallet recipient must pre-register")
          const wrapKey = await deriveWalletWrapKey(r.registrationSignature)
          return { ...r, wrappedShardB: xorBytes(shardB!, wrapKey) }
        }
      }))
    : []

  // 6. Upload ciphertext to Shelby.
  //    `walletSigner` is the connected wallet's signer (the Aptos wallet-adapter
  //    signAndSubmitTransaction path), passed in by the page. See "Open questions to resolve
  //    BEFORE building" — if Shelby's SDK doesn't accept a wallet signer, this is the resolved
  //    fallback signer instead. There is no getAccountFromWallet(); that cannot exist.
  const { blobName } = await uploadCiphertext({
    signer: args.walletSigner,
    ciphertext,
    blobName: `deaddrop_${dropId}`,
    expirationMicros: chooseExpiration(args.releaseAtMs),
  })

  // 7. POST drop metadata. The backend receives only gated/wrapped material:
  //    - tlockShardA (tlock of shardA or K — useless until the round publishes) OR contractRef
  //    - ownerShardA / ownerKeyWrapped (useless without the owner's wallet signature)
  //    - PRIVATE: per-recipient wrappedShardB + temporary email secrets
  //    - PUBLIC: none of the above
  //    At NO point does the backend hold a raw shardA or raw K.
  await fetch("/api/drops", {
    method: "POST",
    body: JSON.stringify({
      dropId, mode, distribution, blobName, iv, fingerprint,
      tlockShardA, contractRef, releaseRound,
      ownerShardA: distribution === "private" ? ownerWrapped : undefined,
      ownerKeyWrapped: distribution === "public" ? ownerWrapped : undefined,
      recipients: wrappedRecipients,
    }),
  })

  // 8. Everything sensitive (key, keyBytes, toGate, shardB, secrets) falls out of scope here.
}
```

### Timer reset as actual code

```typescript
// Owner clicks "I'm still here" — re-timelock the gated secret to a later round.
// Works for both private (ownerShardA → shardA) and public (ownerKeyWrapped → K) drops.
async function resetTimer(args: {
  dropId: string
  distribution: "private" | "public"
  ownerWrapped: Uint8Array     // ownerShardA (private) or ownerKeyWrapped (public), from backend
  expectedOldRound: number     // current release_round — concurrency guard for the atomic swap
  newReleaseAtMs: number
  ownerSignFn: (msg: string) => Promise<string>
}) {
  // 1. Recover the gated secret using the owner's wallet (operator can't do this)
  const ownerWrapKey = await deriveWalletWrapKey(
    await args.ownerSignFn(`deaddrop:owner:${args.dropId}`)
  )
  const gated = xorBytes(args.ownerWrapped, ownerWrapKey)   // shardA (private) or K (public)

  // 2. Re-timelock to the new round
  const newRound = roundForTime(args.newReleaseAtMs)
  const newTlockShardA = await timelockEncryptShardA(gated, newRound)

  // 3. Atomic update — the endpoint guards on expectedOldRound (returns 409 on race/release)
  const res = await fetch(`/api/drops/${args.dropId}/reset`, {
    method: "POST",
    body: JSON.stringify({
      tlockShardA: newTlockShardA,
      releaseRound: newRound,
      triggerAt: args.newReleaseAtMs,
      expectedOldRound: args.expectedOldRound,
    }),
  })
  if (res.status === 409) throw new Error("Drop already released or a concurrent reset won — reload and retry")
  // gated secret falls out of scope
}
```

Note: reset only applies to **timelock** drops (multisig has no timer). And it requires `keepOwnerCopy` to have been true at creation — a true-commitment drop with no owner copy cannot be reset (by design).

---

## Shelby integration

The real Shelby SDK is `@shelby-protocol/sdk` and `@shelby-protocol/react` (verified against `docs.shelby.xyz`). The React SDK exposes hooks; the core SDK exposes lower-level functions. We use both.

```typescript
// lib/shelby.ts — wrapper around the real SDK
// Components should call this module, never the SDK directly.

// NOTE on `signer`: this is whatever Shelby's SDK actually accepts — see "Open questions to
// resolve BEFORE building". Do NOT type it as a raw private-key `Account` constructed from the
// wallet (that's impossible). Use the connected wallet's signer (signAndSubmitTransaction) if the
// SDK accepts it; otherwise the resolved fallback. Type it as the SDK's signer interface, or a
// thin `ShelbySigner` wrapper this module defines, once the SDK's real type is known.

// Returns the blob name after a successful upload.
// Blobs MUST have a name and an expiration (microseconds since epoch).
export async function uploadCiphertext(args: {
  signer: ShelbySigner             // the signer Shelby's SDK accepts (wallet-adapter signer preferred)
  ciphertext: Uint8Array
  blobName: string                 // e.g. `deaddrop_${dropId}`
  expirationMicros: number         // Date.now() * 1000 + duration_in_micros
}): Promise<{ blobName: string }>

// Download by blob name. Returns the raw ciphertext bytes.
export async function downloadCiphertext(
  blobName: string
): Promise<Uint8Array>

// List blobs owned by an Aptos account.
export async function listBlobs(args: {
  account: string                  // Aptos address
  limit?: number
  offset?: number
}): Promise<BlobMeta[]>
```

**Important Shelby constraints (from docs and whitepaper):**
- Blobs are **immutable** once uploaded
- Blobs require an **explicit expiration** at upload time, expressed in microseconds. Set it to comfortably overshoot the release time (see Renewal logic below)
- Blob **names** are user-supplied (not auto-generated IDs); use `deaddrop_${dropId}` for namespacing
- Upload requires an **Aptos signer** (not Solana or EVM) — payment, Merkle commitment, and metadata all live on Aptos
- Files under ~10 MiB are zero-padded by the protocol; small files have overhead. Group small files if relevant later
- Browser uploads work — the SDK is isomorphic, but you may need Next.js webpack polyfills (see CLAUDE.md Step 6)

**React hooks alternative:** `@shelby-protocol/react` provides `useUploadBlobs`, `useAccountBlobs`, etc., built on `@tanstack/react-query`. We use the hooks in components where possible (gives free loading/error states) but keep the imperative `lib/shelby.ts` wrapper for use in non-React code (the crypto pipeline).

---

## Funding & economics

Shelby uses a two-token model. To upload a blob, the Aptos account doing the upload needs both:

- **APT** — Aptos's native token, pays gas for the on-chain transactions (blob commitment, metadata)
- **ShelbyUSD** — a USD-pegged token, pays for actual storage duration and read bandwidth

Storage is paid per byte per duration. Reads are paid per byte transferred. This is Shelby's "paid reads" model — it's what makes hot decentralized storage economically viable, but it means **every drop has a real cost** and the wallet must be funded before arming.

### Testnet funding

On shelbynet (and Aptos testnet) both tokens are obtainable from faucets:

- Aptos testnet faucet: gives test APT
- Shelby faucet: `docs.shelby.xyz/apis/faucet/shelbyusd` — gives test ShelbyUSD to a specified address

We wrap both in `lib/funding.ts`:

```typescript
// lib/funding.ts

export async function getBalances(address: string): Promise<{
  apt: bigint
  shelbyUsd: bigint
}>

// Requests testnet APT from the Aptos faucet
export async function requestAptFromFaucet(address: string): Promise<void>

// Requests testnet ShelbyUSD from the Shelby faucet
export async function requestShelbyUsdFromFaucet(address: string): Promise<void>

// Returns true if the account has enough of both tokens to upload at least one drop
export async function hasMinimumBalance(address: string): Promise<boolean>
```

### Onboarding flow with funding check

```
User connects Petra wallet
       │
       ▼
Check balances (APT + ShelbyUSD)
       │
       ├── Both sufficient ──► Go to dashboard
       │
       └── Insufficient ──► Funding modal
                              "Your account needs test tokens
                               to arm a drop. Get them now?"
                              [ Get test funds ] [ I'll do this later ]
                              │
                              ▼
                              Call both faucets in parallel
                              Show progress, wait for confirmation
                              Refresh balances
                              On success: go to dashboard
```

The funding modal only appears on testnet. On mainnet, users acquire ShelbyUSD through whatever on-ramp Shelby provides (DEX swap, fiat purchase, etc.) — that's outside our app's scope. The UI should still surface a balance warning before letting them attempt an upload they can't afford.

### Cost transparency in the arm-drop flow

Before the user clicks "Arm drop" on the confirm screen, show an estimate:

```
File size:              4.2 MB
Storage duration:       30 days
Estimated storage cost: ≈ $0.02 in ShelbyUSD
Estimated gas:          ≈ 0.001 APT
```

These numbers come from the Shelby SDK's pricing helpers (verify the actual API — there's likely a `quoteUpload()` or similar). Don't ship without surfacing this. Users entering a system that charges per operation deserve to know what they're spending.

### Renewal logic

Shelby blobs **expire** at their stored expiration. If a drop has a 6-month timer but the blob was uploaded with 30 days of storage, the blob disappears before the timer ever fires.

At launch: default blob expiration is `max(30 days, checkInIntervalDays + gracePeriodDays + 30)` — always overshoot the release window by at least 30 days. Set at upload time in `lib/shelby.ts`.

Future hardening: a background renewal job that tops up storage as expiration approaches. This requires either:
- A keeper bot the user runs themselves
- A small server the app operator runs
- A Move contract that auto-renews from a user-funded escrow

This is genuinely tricky and deserves its own design pass when we get there.

---

## Notification & delivery

This section is about **private drops** — they need recipients to be told when the condition is met. Email is the universal entry point for private drops; what the recipient does after clicking differs by recipient type (email vs wallet).

**Public drops do not use this system.** They have no recipients and no emails — the owner shares the link themselves, and the `/p/[dropId]` page self-unlocks via drand/contract. The notifier simply stamps `releasedAt` on public drops for dashboard status and moves on.

### Architecture

A small backend service runs autonomously, independent of any user's browser session. Three components:

```
┌─────────────────────────┐    ┌──────────────────────┐    ┌──────────────────┐
│  Scheduled job          │───▶│  /api/cron/release   │───▶│  Resend API      │
│  (hourly)               │    │  - finds drops whose │    │  - sends emails  │
│                         │    │    drand round passed│    └──────────────────┘
│                         │    │    or contract fired │
│                         │    │  - marks released    │
│                         │    │  - dispatches mails  │
└─────────────────────────┘    └──────────────────────┘
                                          │
                                          ▼
                               ┌──────────────────────┐
                               │  Supabase Postgres   │
                               │  drops, recipients,  │
                               │  recipient_secrets   │
                               └──────────────────────┘
```

### Backend pieces

**The backend is a notifier, never a key custodian.** It observes that a release condition has been met (a drand round has published, or the Move contract emitted a release) and emails recipients their links. It cannot decrypt anything — it has no raw shardA at any time.

**Database (Supabase Postgres).** Tables: `drops`, `recipients`, `recipient_secrets`. The `recipient_secrets` table temporarily holds email-recipient secrets — written at drop creation, deleted the instant the notification email is sent. Note: even while a secret is stored, it is not sufficient to decrypt, because the backend has no raw shardA (timelock drops) or cannot satisfy the contract (multisig drops). The secret only unwraps shardB, which is half the key.

**Scheduled job (hourly).** Queries drops that are `armed` and whose release is now satisfiable: for timelock drops, `releaseRound` has been published by drand; for multisig drops, the contract reports threshold met. For each, marks `releasedAt`. For **private** drops it then sends emails and deletes secrets; for **public** drops it does nothing further (the `/p` page self-unlocks).

**Email service (Resend).** Transactional emails from a domain we own, with SPF + DKIM + DMARC. Two templates (email recipient, wallet recipient).

**Retrieval API route (`/api/retrieve/[dropId]/[recipientId]`).** Returns the decryption payload (the locked `tlockShardA` or `contractRef`, plus `wrappedShardB`, IV, blobName, fingerprint), atomically burning the link. The payload it returns still cannot be used by anyone but the intended recipient: `tlockShardA` requires the published drand round, `wrappedShardB` requires the recipient's secret or signature.

### URL structure

**Email recipient URL:**
```
https://deaddrop.app/r/${dropId}/${recipientId}#${base64UrlEncode(secret)}
```

The secret lives in the URL **fragment** (after `#`). Browsers never send fragments to servers — the secret stays in the recipient's browser only. The server never sees it, can't log it, can't leak it through access logs.

**Wallet recipient URL:**
```
https://deaddrop.app/r/${dropId}/${recipientId}
```

No fragment needed — the wallet signature supplies the unwrap key.

### Email templates

Two short, plain emails. From: `notifications@deaddrop.app`. The from-name is the sender's name (e.g. `"Sarah Chen via DeadDrop <notifications@deaddrop.app>"`) so it reads naturally in the recipient's inbox.

**Email recipient template (HTML + plaintext):**

> Subject: Sarah Chen left something for you
>
> Sarah Chen used DeadDrop to set aside a file for you, with instructions that you receive it if she did not check in by May 25, 2026. That moment has now passed.
>
> What this is: an encrypted file that only you can open.
> What to do: click the button below within the next 7 days. The page will decrypt the file in your browser and let you download it. You do not need to install anything or create an account.
>
> Important: this link can only be used once. Save the file as soon as you download it.
>
> [Open the file]   ← large button, URL with secret in fragment
>
> Plain link (if the button doesn't work):
> https://deaddrop.app/r/...#...
>
> If you're not sure this is legitimate, you can verify at deaddrop.app/about or reply to this email.
>
> — DeadDrop
> This message was sent because Sarah Chen designated you as a recipient. It was generated automatically; no one at DeadDrop has read its contents.

**Wallet recipient template:** same structure, slightly different middle paragraph noting that wallet signature will be required.

**Backup email behavior:** if a recipient has both `email` and `backupEmail` set, both addresses receive identical messages with the same link. Either can be used; the first one to claim burns both.

### Cost transparency in the email

Recipients do not pay for retrieval. Reads on Shelby are paid by us (the app operator) out of a pool funded at upload time. The owner sees the total cost — including expected retrieval bandwidth — on the confirm screen before arming the drop.

### Trust model — what the backend can and cannot do

With a centralized notifier, we (the operators) are part of the *availability and metadata* trust model, but — by design — **not** the *confidentiality* trust model. Here is the precise breakdown.

**What a full backend compromise CANNOT do, at any point in a drop's life:**
- Decrypt any file. For timelock drops, the backend holds `tlockShardA`, which is unrecoverable until the drand round publishes — the attacker is in exactly the same position as the public. For multisig drops, the backend cannot satisfy the on-chain threshold. In neither case does the backend hold a raw shardA.
- Even combined with a stored email secret (which only unwraps `wrappedShardB`), the attacker still lacks shardA. Half the key is not the key.

This is the crucial improvement over the earlier design: **there is no window — not before release, not after — in which compromising our infrastructure yields a decryptable file.** Confidentiality does not depend on trusting us.

**What a full backend compromise CAN do:**
- **Suppress or delay** notifications (an availability attack, not a confidentiality one). Mitigation: timelock drops release on drand regardless of us; a technical recipient or the owner can compute the retrieval themselves once the round publishes, even if our email never arrives. We should document the manual retrieval path for this reason.
- **Send notification emails to attacker-modified addresses.** This is the real residual risk: an attacker who rewrites a recipient's email/wallet record before release could redirect the notification. But note: redirecting the *email* doesn't grant decryption unless the attacker also controls the recipient's unwrap material. For email recipients, the secret travels in the email — so a redirected email IS a compromise of that recipient. For wallet recipients, a redirected email is useless without the recipient's wallet. **This is the strongest argument for wallet recipients on the most sensitive drops.**
- **Reveal metadata:** who owns drops, who the recipients are, their emails, timing. Content stays protected; the social graph does not.

**Mitigations:**
- Retrieval secrets live in the URL fragment, never sent to or logged by the server
- `recipient_secrets` is service-role only (RLS denies all client access); the secret is deleted the moment it's emailed
- Recipient records are integrity-checked: changes to a recipient's email or wallet after the owner arms the drop should require owner re-authorization (and ideally be anchored on-chain in the multisig case)
- Wallet recipients are immune to email-redirection compromise — recommend them for high-threat drops
- The drand and Move release mechanisms are independent of our backend, so confidentiality survives our total compromise

### Threat model — plain statement

What DeadDrop protects against:
- Breach of our backend or database → no file is decryptable
- Breach of Shelby storage nodes → they hold only ciphertext
- Early decryption attempts on a timelock drop → mathematically prevented until the round publishes
- A stolen or forwarded retrieval link after use → burned, returns 410
- Coercion/subpoena of the operator → we have no key to surrender

What DeadDrop does NOT (and cannot) protect against:
- **A compromised owner device at encryption time.** The plaintext is there; nothing downstream can help.
- **A compromised recipient email account** (for email recipients) — the link is the credential. Wallet recipients are immune.
- **A malicious or coerced frontend.** Because the app is delivered as web JavaScript, whoever serves the JS could in principle serve a backdoored version that exfiltrates the key during encryption or decryption. This is the deepest unavoidable risk of *any* browser-delivered crypto app (it applies to Proton, Signal's web client, etc.). **It cannot be fully eliminated — but it can be made *detectable* rather than silent.** See "Verifiable delivery" below.
- **Quantum adversaries.** The drand timelock and the multisig threshold-BLS/IBE both use BLS/IBE, which is not quantum-resistant. A sufficiently capable quantum computer (none exists today) could threaten confidentiality of both condition types. This is shared by essentially all deployed public-key cryptography and is a long-horizon concern; note it, and track post-quantum IBE as a future migration.
- **Metadata analysis.** Timing and the existence of a relationship remain visible to us. But who the recipients are and what a drop is called are now encrypted — see "Metadata minimization" below.

The honest one-line summary for users: *"We cannot read your files, and neither can anyone who breaks into our servers. The main things you must still trust are your own device and the code we serve you — and that code is published and verifiable so you can check we haven't tampered with it."*

### Verifiable delivery (reducing the frontend-trust risk)

We cannot make it *impossible* for the operator to serve malicious JS — no website can. We make it *detectable and pinnable*, shifting from "trust us blindly" to "trust, but verify, with a permanent record if we cheat":

- **Subresource Integrity (SRI).** Every script/style bundle is referenced with its SHA-384 hash. A browser refuses to run a bundle whose bytes don't match. The expected hashes are published.
- **Reproducible builds.** The open-source repo builds bit-for-bit to the deployed hashes, so anyone can independently confirm the live app equals the published source.
- **Code transparency log.** Every deployed bundle hash is appended to a public, append-only log (the Certificate-Transparency model). A *targeted* attack — serving bad code to one user — becomes a provable, permanent record rather than an undetectable one-off.
- **Optional signed desktop/extension build** for the highest-threat users. Extensions update visibly and are signed, closing the "swap the JS on a single request" hole inherent to websites.

This does not let us decrypt anything — it ensures that if we (or an attacker who compromised our hosting) ever ship code that tries to, it is catchable. For most users SRI + reproducible builds is enough; the extension is for those who need to remove the website from their trust set entirely.

### Metadata minimization (what we deliberately do NOT learn)

Confidentiality of file *contents* was never in our hands. We additionally minimize the *metadata* we hold:

- **Drop titles are encrypted client-side** under a single, drop-independent owner key (derived once per session from a fixed-message wallet signature, `deaddrop:title-key:v1`, and cached in memory). The backend stores only ciphertext; the owner's dashboard decrypts all titles locally with that one key — one signature, not one prompt per drop. We never learn what a drop is called.
- **Recipient and signer email addresses are encrypted at rest**, decryptable only by the notifier at send time (under a key held in the notifier's environment, not in the database). A database dump does not reveal who the recipients are. *(The notifier process necessarily sees an address at the moment it sends — that's irreducible for email delivery — but it is not stored in readable form.)*
- **What unavoidably remains:** a drop exists, roughly when it releases, and the number of recipients/signers. Hiding even that requires mixnet-grade techniques out of scope here. We state this plainly rather than implying perfect metadata privacy.

So metadata exposure drops from "we know everyone and everything" to "we know a drop exists, approximately when it fires, and how many parties — but not who they are or what it contains."

---

## Recipient setup UX

The confirm screen (`/new/confirm`) is where recipients get added. For each one:

```
┌─────────────────────────────────────────────────┐
│ Recipient 1                                      │
│                                                  │
│ Name (optional, only you see this)               │
│ [ Alice (sister)                              ]  │
│                                                  │
│ Recipient type                                   │
│ ◉ Email — works for anyone, no setup needed     │
│ ○ Wallet — stronger, requires pre-registration  │
│                                                  │
│ Email address (required for notification)        │
│ [ alice@gmail.com                              ] │
│                                                  │
│ Backup email (optional, recommended)             │
│ [ alice.smith@protonmail.com                   ] │
│                                                  │
│ [ Remove ]                                       │
└─────────────────────────────────────────────────┘
                                  [ + Add recipient ]
```

If "Wallet" is selected, the panel expands to show:

```
Wallet address
[ 0x7f3a2c81b9d4e5f6a7c8b9d0e1f2a3b4c5d6e7f8 ] [ Chain: Aptos ▾ ]

⚠ This recipient must register their wallet before you arm the drop.
   We'll email them a one-time setup link. They sign once and you're done.
   [ Send registration link ]   ← button enabled once address + email are valid

Status: ⏳ Waiting for registration — Alice hasn't signed yet
        ✓ Registered — ready to include in the drop
```

The owner cannot arm the drop until all wallet recipients have completed registration. This is a real UX cost but it's only paid by users opting into the stronger security path.

**Email recipients need no pre-setup.** Just the email address.

### Signer setup (multisig drops only)

When `mode = multisig`, the confirm screen also collects the **signers** — the people whose approvals release the drop — separately from recipients. For each signer:

```
┌─────────────────────────────────────────────────┐
│ Signer 1                                         │
│ Name (optional)      [ Dr. Reyes (lawyer)     ]  │
│ Wallet address       [ 0x9a2f...c4d1          ]  │
│ Email (for the request) [ reyes@firm.com      ]  │
│ [ Send registration link ]                       │
│ Status: ⏳ Waiting for encryption-key registration│
│         ✓ Registered                              │
└─────────────────────────────────────────────────┘
Threshold: [ 2 ] of [ 3 ] signers must approve
```

Each signer must complete signer pre-registration (connect wallet, establish their BLS key share of the group key) before the owner can arm — the signer's BLS public key is needed on-chain to verify their approval signature, and their encrypted key share is needed so they can sign later. The owner sets the threshold (k of n). The owner cannot arm a multisig drop until every signer is registered.

Make the timelock-vs-multisig semantic difference explicit at mode-selection time (see the Data model note): timelock auto-releases on inactivity; multisig releases only when signers actively approve and never fires on its own.

---

## Aptos / Move integration

The Move contract ships at launch. It does two jobs:

**1. On-chain anchor (all drops).** A lightweight registry: drop id, owner address, mode, creation time, and an audit trail. This gives drops a tamper-evident on-chain record and lets technical users verify a drop exists and its state independently of our backend.

**2. Threshold-gated release for multisig drops, using the SAME IBE primitive as timelock.**

The key realization: timelock and multisig are the *same cryptographic operation* with a different "authority." tlock works because drand is a **threshold IBE network** — `t` of `n` drand nodes produce a BLS-based decryption key for an identity (the round number). Multisig is identical: `t` of `n` **signers** produce a decryption key for an identity (the drop id). Both are Boneh–Franklin IBE over threshold BLS — the construction drand itself uses. (See the NIST/drand talk "Timelock Encryption: an Overview and Retrospective" and ia.cr/2023/189: "threshold BLS to replace the trusted IBE authority with a network of parties, each potentially malicious.")

So we do **not** hand-roll a bespoke VSS + commitment + ECIES scheme. We reuse the IBE encryption path and swap the authority:

- **Timelock drops:** identity = drand round; authority = drand (League of Entropy). Encrypt/decrypt via `tlock-js`.
- **Multisig drops:** identity = `dropId`; authority = the drop's signer group. Encrypt the secret to the signer group's BLS public key (same IBE encrypt). A signer "approves" by publishing a **BLS signature share over `dropId`** — the exact operation a drand node performs over a round number. When `t` shares exist, anyone aggregates them into the IBE decryption key and decrypts — the **same decrypt path** as timelock.

This collapses two crypto schemes into one. There is a single IBE encrypt and a single IBE decrypt; only the source of the decryption key differs (drand beacon vs. aggregated signer signatures).

**Why this is far safer than a hand-rolled VSS:**
- A signer's approval is a **BLS signature**, which is *self-verifying* against that signer's known BLS public key. The contract just does a standard BLS verify (Aptos has native BLS12-381 support). No Feldman/Pedersen commitment machinery to implement or get wrong.
- No separate "encrypt each share to each signer" ECIES step. Signers hold a BLS key share, registered once.
- One decryption routine shared with the audited timelock path.
- It is a published, reviewed construction, not novel composition.

**Setting up the signer group key.** The signer group needs a shared BLS public key whose secret is `t`-of-`n` split across signers. Two options:
- **Launch (owner-dealt):** the owner generates a BLS keypair, Shamir-splits the secret key into `n` shares, encrypts each share to its signer (at registration the signer provides a public key), publishes the group public key, and **discards the master secret**. Simple; works with non-technical signers. Cost: the owner momentarily held the group secret key during setup. This is acceptable under our model — the owner had the plaintext anyway, and "conditions bind recipients and third parties, not the owner." After setup the owner cannot recover it (shares are encrypted to signers).
- **Trustless (later, optional):** a real interactive **DKG** among the signers so no one — including the owner — ever holds the full secret key. Better, but awkward UX for non-technical signers. Offer as an advanced option post-launch.

**What lives on-chain (all public-safe):** the group BLS public key, the per-signer encrypted key shares (only that signer can decrypt theirs), the drop's IBE ciphertext header, and — as signers approve — their published BLS signature shares over `dropId`. Reading chain state before `t` signatures exist yields nothing decryptable: IBE ciphertext without the identity key, plus sub-threshold signature shares (which reveal nothing, by BLS threshold security).

**To approve, signer `i`:**
1. Decrypts their BLS key share (encrypted to them at setup) with their wallet.
2. Produces a BLS signature share over `dropId`.
3. Calls `approve_release(dropId, sigShare)`; the contract verifies it against signer `i`'s registered BLS public key and records it.

Once `t` valid signature shares exist, anyone aggregates them into the IBE decryption key for identity `dropId`, then runs the **same IBE decrypt** used for timelock to recover the secret (shardA for private drops, K for public).

**Multisig drops have NO owner copy.** After owner-dealt setup the owner discarded the master; they cannot reconstruct alone. (A user wanting "approvers AND I can always get it back" should use a timelock drop with those people as wallet recipients.)

Time-lock drops do **not** use the contract for the secret — drand handles the IBE authority. The contract still records timelock drops for the audit trail.

```move
module deaddrop::DeadDrop {
  struct Drop has key {
    id: vector<u8>,
    owner: address,
    mode: u8,                       // 0 = timelock, 1 = multisig
    distribution: u8,               // 0 = private, 1 = public
    created_at: u64,

    // multisig only:
    threshold: u8,
    signers: vector<address>,
    signer_bls_pubkeys: vector<vector<u8>>,  // each signer's BLS public key (from registration)
    group_pubkey: vector<u8>,                // group BLS public key (identity authority)
    enc_key_shares: vector<vector<u8>>,      // each signer's BLS secret-key share, encrypted to them
    ibe_ciphertext_header: vector<u8>,       // IBE encryption of the secret to identity = id
    sig_shares: vector<vector<u8>>,          // BLS signature shares over id, filled as signers approve
    approvals: vector<address>,
    released: bool,                          // true once |approvals| >= threshold
  }

  // Register a drop (audit anchor). For multisig, stores the group key, enc'd key shares,
  // signer BLS pubkeys, and the IBE ciphertext header.
  public entry fun create_drop(/* id, mode, distribution, signers, threshold,
                                  group_pubkey?, signer_bls_pubkeys?, enc_key_shares?,
                                  ibe_ciphertext_header? */)

  // Multisig: signer publishes a BLS signature share over `id`.
  // Contract BLS-verifies it against signer_bls_pubkeys[i]; records it; flips released at threshold.
  public entry fun approve_release(drop_id: vector<u8>, sig_share: vector<u8>)

  // Read release state + the published signature shares (aggregate off-chain once released).
  public fun get_release_material(drop_id: vector<u8>): (bool, vector<vector<u8>>)

  // Timelock drops record reset events for the audit trail (no secret material on-chain).
  public entry fun record_reset(drop_id: vector<u8>, new_release_round: u64)
}
```

**The notifier watches this contract** for multisig drops (`released` flips true) and watches drand for timelock drops (round publication). It only triggers email delivery for private drops — it never gains the secret.

---

## Screen → route mapping

| Design screen | Next.js route | Notes |
|---|---|---|
| Landing | `/` | Public, no wallet required |
| Connect wallet | Modal (all pages) | `ConnectModal` component |
| Upload & encrypt | `/new/encrypt` | Requires wallet |
| Condition setup | `/new/condition` | Draft state from Zustand |
| Recipients + confirm | `/new/confirm` | Per-recipient type toggle; wallet recipients require pre-reg |
| Dashboard | `/dashboard` | Requires wallet |
| Drop detail | `/drop/[id]` | Requires wallet, must own drop |
| Wallet recipient pre-registration | `/register/[dropId]/[recipientId]` | Public, wallet connect required; one-time |
| Signer pre-registration (multisig) | `/register-signer/[dropId]/[signerId]` | Public, wallet connect; establishes BLS public key for the signer group |
| Signer approval (multisig) | `/approve/[dropId]/[signerId]` | Public, wallet connect; decrypts own share, publishes on-chain |
| Recipient retrieval (private) | `/r/[dropId]/[recipientId]` | Public page; URL fragment carries secret for email recipients |
| Public retrieval | `/p/[dropId]` | Public page; self-unlocks via drand/contract; no secret, no burn |
| Security model | `/security` | Public; plain-language threat model, linked from banner + emails |

---

## Wallet connect flow

```
User clicks "Get started" or "Connect wallet"
        │
        ▼
ConnectModal opens — shows Petra (active), Phantom/MetaMask/WalletConnect (Coming soon)
        │
        ▼
User selects Petra → wallet adapter handles connection
        │
        ▼
On success: store { address, chain, walletName } in Zustand
        │
        ▼
Check balances (APT + ShelbyUSD) via lib/funding.ts
        │
        ├── Both sufficient ──► Redirect to /dashboard
        │
        └── Insufficient ──► Open FundingModal automatically
                              (user can still browse dashboard, but
                              "Arm drop" is disabled until funded)
```

**Key UX rule from design brief:** wallet connection must NOT be the first thing users see. The landing page explains the product first. "Get started" triggers the connect modal.

---

## Launch scope

This is one system. Everything below ships together because the security model depends on it.

✅ Core (all required for launch):
- Full UI (12 pages: landing, dashboard, encrypt, condition, confirm, drop detail, recipient register, signer register, signer approve, private retrieve `/r`, public retrieve `/p`, security)
- Client-side AES-256-GCM encryption in the browser
- XOR key split; per-recipient shardB wrapping (email + wallet paths)
- **Private and public distribution modes** — private (specific recipients, single-use links) and public (one shareable link, self-unlocking, the "post on X" case)
- **drand timelock encryption** of shardA (private) or K (public) for time-lock drops (`tlock-js`)
- **Move contract** for multisig: verifiable secret sharing — W Shamir-shared across signers, each share encrypted to a signer's key, revealed on approval; plus on-chain audit anchor for all drops
- Signer pre-registration (encryption pubkey) and recipient pre-registration (wallet path), both gating arm
- Owner secret wrapping for timelock resets (no operator custody); multisig drops have no owner copy by design
- Shelby blob upload + download (shelbynet) OR working mock if SDK unavailable
- Funding check + testnet faucets (APT + ShelbyUSD); cost preview before arming
- Supabase database (drops, recipients, recipient_secrets) with RLS
- Resend email with two templates; SPF/DKIM/DMARC configured
- Scheduled notifier job (watches drand rounds + contract events), sends emails
- Retrieval API with atomic burn-on-use + 7-day expiry
- Wallet recipient pre-registration flow
- Petra wallet connect + signing
- Private recipient retrieval page (all four path combinations), fingerprint verification before decrypt
- Public retrieval page (`/p/[dropId]`) that self-unlocks via drand/contract, with live countdown before release
- Atomic timer reset (re-timelock with optimistic-concurrency guard); reset disabled after release
- Manual retrieval path documented (so confidentiality survives our backend being down)
- Security model page + honest threat-model disclosure in-app

🚫 Deliberately out of scope at launch (genuine future work, not security-critical shortcuts):
- Phantom / MetaMask recipient wallets (shown "Coming soon"; Petra + Aptos only at launch)
- k-of-n recipient backup shards (n > 2) — would need real Shamir
- Autonomous Shelby blob renewal (set generous expiration at upload instead)
- Reproducible builds / browser-extension client for the highest-threat users
- Any notification channel other than email

Note: there is no "stub the security and fix it later" item on this list. The drand and Move mechanisms are core because removing them would reopen operator custody.

---

## Environment variables

```bash
# .env.local — client-safe (NEXT_PUBLIC_ prefix means exposed to browser)
NEXT_PUBLIC_APTOS_NETWORK=testnet
NEXT_PUBLIC_SHELBY_NETWORK=shelbynet
NEXT_PUBLIC_USE_SHELBY_MOCK=false
NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS=                    # required at launch
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...                      # public, RLS-protected
NEXT_PUBLIC_APP_URL=https://deaddrop.app                  # used to build email links

# .env.local — server-only (no NEXT_PUBLIC_ prefix; never bundled into client code)
SUPABASE_SERVICE_ROLE_KEY=eyJ...                          # admin access, server use only
RESEND_API_KEY=re_...
CRON_SECRET=...                                           # protects /api/cron/release from public access
EMAIL_ENC_KEY=...                                         # symmetric key to decrypt recipient/signer emails at send time
```

**Critical:** `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, and `EMAIL_ENC_KEY` must never appear in client code or be prefixed with `NEXT_PUBLIC_`. They are only readable by Next.js API routes and the cron function. If you find yourself importing any of them into a component, stop.

---

## Key external docs

- Shelby docs (root): https://docs.shelby.xyz
- Shelby React SDK guide: https://docs.shelby.xyz/sdks/react
- Shelby quickstart: https://github.com/shelby/shelby-quickstart
- Shelby examples: https://github.com/shelby/examples
- Shelby whitepaper (arXiv): https://arxiv.org/pdf/2506.19233
- Aptos wallet adapter: https://github.com/aptos-labs/aptos-wallet-adapter
- Aptos TS SDK: https://aptos.dev/build/sdks/ts-sdk
- Web Crypto API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
- Shelby faucet (ShelbyUSD): https://docs.shelby.xyz/apis/faucet/shelbyusd
- Aptos faucet: https://aptos.dev/network/faucet
- Supabase: https://supabase.com/docs
- Resend (email): https://resend.com/docs
- React Email (templates): https://react.email
- drand timelock docs: https://docs.drand.love/docs/timelock-encryption/
- tlock-js (library): https://github.com/drand/tlock-js
- timevault (reference dead-man's-switch app): https://github.com/drand/timevault
- tlock security audit (Kudelski): https://kudelskisecurity.com/research/audit-of-drand-timelock-encryption

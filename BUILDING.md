# CLAUDE.md — Instructions for Claude Code

This file tells you everything you need to know about this codebase. Read it before writing any code.

---

## Project

**Until Then** — a dead man's switch for sensitive files. Users encrypt files client-side, upload the ciphertext to Shelby (decentralized hot storage on Aptos), and configure a condition (time-lock or multi-sig) that controls when the decryption key is released. Recipients decrypt locally. **No server ever sees plaintext, and — by design — the operator never holds everything needed to decrypt any drop at any point in its life.**

The central invariant: shardA (half the key) is gated either by **drand timelock encryption** (time-lock drops) or an **on-chain Move contract** (multisig drops), never by our backend. shardB (the other half) is wrapped per-recipient. Read the "Core security principle" and "Encryption architecture" sections of ARCHITECTURE.md before writing any code — that invariant is the whole point of the project and must not be weakened for convenience.

Read `ARCHITECTURE.md` for the full technical blueprint before starting.

---

## Non-negotiable rules

### 1. Never handle plaintext outside the browser
All encryption and decryption happens in `lib/crypto.ts` using the native Web Crypto API. Never send unencrypted file data to any server, API route, or external service. If you find yourself writing `fetch('/api/...', { body: fileData })` — stop.

### 2. The operator must never hold a decryptable secret
This is the project's core invariant. "The secret" = shardA for private drops, or K itself for public drops. The backend may store `tlockShardA` (locked by drand until a future round) or `ibeHeader` + a `contractRef` (locked by the signer-group threshold) — but **never a raw, usable secret**, and never alongside enough other material to reconstruct the key. Before writing any code that touches the secret, ask: "if this database were dumped right now, could the attacker decrypt?" The answer must be no. If a change would make the answer yes, stop — it violates the invariant.

Specifically:
- Time-lock drops: the secret is timelock-encrypted in the browser via `lib/timelock.ts` before anything is sent to the backend. The raw secret never leaves the browser.
- Multisig drops: the secret is IBE-encrypted in the browser to identity=dropId under the signer-group key (`lib/contract.ts`); the backend/chain gets only the IBE header. Release needs a threshold of signer BLS signature shares — never held by us.
- The owner's reset copy (`ownerShardA`/`ownerKeyWrapped`, timelock only) is XORed with the owner's wallet-signature-derived key before storage — also useless to the backend.
- Never put a raw secret on-chain: Aptos global storage is publicly readable, so a struct field is public regardless of any access-check function.

### 3. TypeScript strict mode, no `any`
`tsconfig.json` has `"strict": true`. Do not use `any`. If you don't know the type, use `unknown` and narrow it. If you're tempted to cast with `as SomeType`, add a comment explaining why it's safe.

### 4. Crypto operations belong in `lib/crypto.ts` only
Do not inline crypto logic in components, pages, or API routes. All Web Crypto API calls, XOR splitting, HKDF derivation, signature wrapping, and fingerprint generation live in `lib/crypto.ts` and are exported as named functions. Components call these functions — they don't implement them.

### 5. The design is the source of truth for UI
The Claude Design output (in `/design/`) defines the visual language: colors, typography, spacing, component patterns. When building UI components, match the design. Do not introduce new UI patterns. If something in the design is unclear, ask — don't invent. New pages not in the design (registration, retrieval flows for both types) should be built using the existing design's component vocabulary.

### 6. Wallet adapter calls go through `lib/aptos.ts`
Do not call `window.aptos` or wallet adapter hooks directly from components. All wallet interactions (sign message, sign transaction, get address) are wrapped in `lib/aptos.ts`. This keeps components clean and isolates contract integration in one place.

### 7. Server-only secrets never touch the client
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, and `EMAIL_ENC_KEY` are server-only. They must:
- Never appear in any file under `app/` that isn't an API route (`route.ts`)
- Never be prefixed with `NEXT_PUBLIC_`
- Never be imported into a file with `"use client"` at the top

If you write `import { serverSupabase } from "@/lib/db"` in a client component, Next.js will throw at build time. Treat that error as a feature, not a problem to work around.

### 8. The retrieval API must burn atomically
`GET /api/retrieve/[dropId]/[recipientId]` is the most security-sensitive endpoint in the app. The check-and-burn must be a single atomic SQL operation, not a read followed by a write:

```sql
-- CORRECT (atomic):
UPDATE recipients SET released_at = now()
WHERE id = $1 AND released_at IS NULL
RETURNING wrapped_shard_b, /* ... */;
-- If 0 rows returned: already burned, return 410

-- WRONG (race condition):
SELECT released_at FROM recipients WHERE id = $1;
-- ... check if null ...
UPDATE recipients SET released_at = now() WHERE id = $1;
```

A concurrent request hitting the wrong pattern can decrypt the file twice. Use `RETURNING` to combine the check and the update.

### 9. When unsure about an external SDK API, check the docs — don't guess
The Shelby SDK, Aptos SDK, Supabase client, and Resend client all evolve. The function signatures in this document were verified at time of writing, but exact prop names and method shapes may have changed. Before writing SDK calls:
- For Shelby: fetch `docs.shelby.xyz/sdks/react` and `docs.shelby.xyz/sdks/typescript`
- For Aptos: fetch `aptos.dev/build/sdks/ts-sdk`
- For Supabase: fetch `supabase.com/docs/reference/javascript`
- For Resend: fetch `resend.com/docs/api-reference`
- If a fetch returns the wrong info or the API doesn't match, stop and ask before writing more code

Guessing at SDK shapes produces broken code that compiles but throws at runtime.

### 10. The Shelby SDK may be access-gated
If `npm install @shelby-protocol/sdk` fails with a 403/404, the package is not yet public — it's likely behind Early Access. In that case: enable the mock (`NEXT_PUBLIC_USE_SHELBY_MOCK=true`), build everything else, and the project is ready to swap in the real SDK the day access is granted.

---

## What to build

Work through this in order. Do not skip ahead.

### Step 0: Place the design files
The Claude Design output (HTML/JSX/CSS produced earlier) is the visual source of truth. Before scaffolding, copy those files into the repo at `/design/` so later steps can reference them:
- `/design/styles.css` — design tokens (colors, typography, radii, spacing)
- `/design/UntilThen.html`, `/design/screens.jsx`, `/design/components.jsx`, `/design/app.jsx` — layouts and component patterns to match

If the design files aren't available in the working directory, ask for them before proceeding — do not invent a visual language. (`tweaks-panel.jsx` from the design export is a design-tool artifact, not app code; ignore it.) The `/design/` folder is reference material; it is not shipped or imported directly — you reimplement its patterns as real components per Step 3+.

### Step 1: Project scaffold
```bash
npx create-next-app@latest until-then \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*"
```

Install dependencies:
```bash
npm install \
  zustand \
  @shelby-protocol/sdk \
  @shelby-protocol/react \
  @aptos-labs/ts-sdk \
  @aptos-labs/wallet-adapter-react \
  petra-plugin-wallet-adapter \
  @tanstack/react-query \
  @supabase/supabase-js \
  resend \
  @react-email/components \
  @react-email/render \
  tlock-js \
  @noble/curves \
  shamir-secret-sharing \
  lucide-react
```

Notes:
- The K=shardA⊕shardB split uses pure XOR (no library)
- `tlock-js` is drand's audited timelock library — handles the IBE timelock path for time-lock drops
- `@noble/curves` provides BLS12-381 (signatures + pairing) for the multisig threshold-BLS/IBE path in `lib/contract.ts` — the same primitive family as tlock, with the signer group as the IBE authority. Aptos also has native BLS12-381 for on-chain signature verification.
- `shamir-secret-sharing` is used ONLY to deal the signer group's BLS secret key across signers at setup (owner-dealt). It is NOT used for the 2-of-2 split and NOT for release (release is BLS signature aggregation).
- `@supabase/supabase-js` is the database client
- `resend` is the email service SDK
- `@react-email/*` packages render the email templates as HTML

**If `@shelby-protocol/sdk` fails to install** (the package may be access-gated during Early Access):
1. Build the project with the mock first (set `NEXT_PUBLIC_USE_SHELBY_MOCK=true`)
2. Note in the README that Shelby integration is pending Early Access approval
3. The mock provides the same API surface using IndexedDB for blob storage

Next.js browser-polyfill note: `tlock-js` (and some crypto deps) expect Node globals like `Buffer`. If you see build/runtime errors about `Buffer` or `crypto` not being defined in the browser, install `buffer` and provide it, and set Node-module fallbacks in `next.config.js`:

```javascript
const webpack = require("webpack")
module.exports = {
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false }
    config.plugins.push(new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }))
    return config
  },
}
```

Verify `tlock-js` actually runs in the browser early (Step 6) rather than discovering a polyfill issue late — it's the highest-risk dependency for browser compatibility.

### Step 2: Design tokens
Port the CSS custom properties from `/design/styles.css` into `styles/globals.css`. These are the canonical design tokens — colors, typography, radii, spacing. Tailwind config should reference them via `var(--...)` where possible.

Key tokens:
```css
--bg-0 through --bg-3    /* dark background scale */
--line-1, --line-2       /* border colors */
--text-1 through --text-4 /* type scale */
--amber, --amber-dim, --amber-soft  /* primary signal color */
--red, --red-soft        /* danger */
--green, --green-soft    /* success */
--font-sans: "Geist"
--font-serif: "Instrument Serif"
--font-mono: "Geist Mono"
```

Add Google Fonts link in `app/layout.tsx`:
```
Geist, Geist Mono, Instrument Serif
```

### Step 3: Primitive UI components
Build these in `components/ui/` before touching any screens. Match the design exactly:

- `Button` — variants: `primary`, `ghost`, `quiet`, `sm`/`lg` sizes
- `Card` — dark bg-1 background, border line-1, border-radius r-lg
- `Input` — dark bg-2 background, focus ring amber
- `Chip` — variants: `armed` (amber), `released` (red), `expired` (muted)
- `Steps` — horizontal progress indicator for the create flow (encrypt → condition → confirm, plus a final "armed" state); match the exact step count/labels in the design
- `Eyebrow` — small caps, tracked, muted text
- `TrustBadge` — small pill with lock icon
- `Countdown` — live countdown from ms, shows `__d __h __m __s`, goes amber when < 2 days
- `ProgressBar` — amber fill, animated

Do not add any components beyond what the design shows.

### Step 4: Wallet provider
Create two wrapping components in `components/wallet/`:

**`WalletProvider.tsx`** — the adapter mount:
- Wraps the app in `AptosWalletAdapterProvider` from `@aptos-labs/wallet-adapter-react`
- Pass `[new PetraWallet()]` from `petra-plugin-wallet-adapter` (note: the official package is `petra-plugin-wallet-adapter`, not `@aptos-labs/wallet-adapter-petra`)
- Configures the network (testnet/mainnet) from env

**`WalletStateProvider.tsx`** — the bridge to our app state:
- Uses `useWallet()` from the adapter to read connection state
- On connect: stores `{ address, chain: "aptos", walletName: "Petra" }` in a Zustand store (`store/wallet.ts`)
- On disconnect: clears that store
- Triggers the funding balance check after a successful connect (calls `getBalances` from `lib/funding.ts`)
- Renders children directly; this component is a behavioral wrapper, not a UI one

Phantom and MetaMask: show in `ConnectModal` but disable with "Coming soon" label. Do not register their adapters.

**Architectural clarification (important):** Shelby uploads require an Aptos signer because payment and on-chain commitment happen on Aptos. That signer is the **connected wallet** (via the wallet adapter's `signAndSubmitTransaction`) — we never hold the user's private key. *Pending verification* that Shelby's SDK accepts a wallet signer (ARCHITECTURE "Open questions to resolve BEFORE building"); if it only accepts a raw `Account`, use the resolved fallback there. The "cross-chain support" only applies to recipients claiming multi-sig approval slots (future work). At launch, only Petra is functional. Other wallets in the modal show "Coming soon" — do not wire them up.

`lib/aptos.ts` imports the `ShelbySigner` type from `lib/shelby.ts` (defined there, in Step 7).

Create `lib/aptos.ts`:
```typescript
// Exports:
// The signer for Shelby uploads. This is the connected wallet's signer (the wallet-adapter
// signAndSubmitTransaction path) — NOT a private-key Account. There is no way to build a raw
// Account from a wallet; that's the whole point of a wallet. See ARCHITECTURE "Open questions to
// resolve BEFORE building": confirm what Shelby's SDK accepts before wiring this. `ShelbySigner`
// is whatever type the SDK's upload expects; define a thin wrapper here once the real type is known.
export function getWalletSigner(): ShelbySigner          // from the connected wallet adapter
export async function signMessage(message: string): Promise<string>  // returns lowercase hex, no 0x
export async function disconnectWallet(): Promise<void>
export function getConnectedAddress(): string | null

// Verify a signature against an address on a given chain.
// Used by the /api/register API route to validate wallet recipient signatures.
// Each chain has a different signature scheme:
//   - aptos: Ed25519
//   - solana: Ed25519
//   - ethereum: ECDSA secp256k1
export async function verifySignature(args: {
  address: string
  chain: "aptos" | "solana" | "ethereum"
  message: string
  signature: string
}): Promise<boolean>
```

**`getWalletSigner()` returns the connected wallet's signer**, used for the Shelby upload. It does NOT return a private-key `Account` — a website never has the user's private key. Before wiring the upload, confirm whether Shelby's SDK accepts this wallet signer or requires something else (ARCHITECTURE "Open questions to resolve BEFORE building"); if it requires a raw `Account`, use the resolved fallback there. Do not write a `getAccountFromWallet()` — it cannot exist.

**Signature format note:** `signMessage` returns a hex string. The crypto layer in `lib/crypto.ts` treats the signature as an opaque UTF-8 string for hashing (`deriveWalletWrapKey` does `SHA-256(UTF8(signature))`). This works regardless of underlying signature scheme as long as the string representation is stable. **Do not change signature formats between registration and retrieval** — the same wallet must produce byte-identical strings both times. Use hex (lowercase, no `0x` prefix) consistently.

### Step 5: Funding helper
Create `lib/funding.ts` for balance checks and testnet faucets:

```typescript
export type Balances = {
  apt: bigint           // octas (1 APT = 10^8 octas)
  shelbyUsd: bigint     // smallest unit
}

export async function getBalances(address: string): Promise<Balances>

// Calls Aptos testnet faucet
export async function requestAptFromFaucet(address: string): Promise<void>

// Calls Shelby faucet at https://docs.shelby.xyz/apis/faucet/shelbyusd
// Verify the actual endpoint URL and request shape from the Shelby docs.
export async function requestShelbyUsdFromFaucet(address: string): Promise<void>

// Returns true if account has enough of both tokens to upload at least one ~10MB drop
export async function hasMinimumBalance(address: string): Promise<boolean>

// Returns an estimate for arming a drop of given size + duration
export async function estimateUploadCost(args: {
  bytes: number
  durationDays: number
}): Promise<{ aptOctas: bigint; shelbyUsdSmallest: bigint }>
```

**Build a `<FundingModal>` component** (`components/wallet/FundingModal.tsx`) that:
1. Shows current APT + ShelbyUSD balances
2. Has a "Get test funds" button that calls both faucets in parallel
3. Shows progress and polls balances until both confirm
4. Only renders when testnet detected (`NEXT_PUBLIC_APTOS_NETWORK !== "mainnet"`)

**Wire it into the post-connect flow:** after `WalletStateProvider` registers a connection, check balances. If insufficient, automatically open the FundingModal. Don't block the dashboard — let users browse the empty state, but show a banner at the top until they fund.

**Cost preview on confirm screen:** the `/new/confirm/page.tsx` page must call `estimateUploadCost` and display the result above the "Arm drop" button. Format as USD for ShelbyUSD, decimals for APT. Never let a user click "Arm drop" without seeing the cost.

### Step 6: Encryption layer
Create `lib/crypto.ts` — this is the most important file. Get it right.

The architecture uses AES-256-GCM for the file and **XOR-based 2-of-2 splitting** for the key, with **per-recipient wrapping** of shardB. Read the "Encryption architecture" section of ARCHITECTURE.md before writing any code here.

Also create `lib/timelock.ts` in this step (the `tlock-js` wrapper, shown below). The `armDrop`/decryption *patterns* further down reference `lib/timelock.ts` (built here) and `lib/contract.ts` (built in Step 12) and `lib/shelby.ts` (Step 7) — those are the orchestration helpers wired together on the pages in Step 15. In this step, build only `lib/crypto.ts` and `lib/timelock.ts` and their unit tests; the `armDrop`/decrypt flows are shown here for context so the crypto API is designed to fit them.

```typescript
// All exports:

// Core symmetric ops
export async function generateKey(): Promise<CryptoKey>
export async function encryptBytes(
  plaintext: ArrayBuffer,
  key: CryptoKey
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }>
export async function decryptBytes(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey
): Promise<Uint8Array>
export async function exportKey(key: CryptoKey): Promise<Uint8Array>
export async function importKey(raw: Uint8Array): Promise<CryptoKey>

// Fingerprint (SHA-256, formatted as 4 groups of 8 hex chars)
export async function fingerprintOf(data: Uint8Array): Promise<string>

// XOR utility used for both wrapping and combining shards
export function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array

// Random bytes — used for shardB and per-recipient secrets
export function randomBytes(n: number): Uint8Array

// HKDF-Expand: turns a 32-byte secret into a 32-byte key with a domain separator
// Used by email-recipient path to derive the unwrap key from the URL secret
export async function hkdfExpand(
  secret: Uint8Array,
  info: string,
  outputBytes: number
): Promise<Uint8Array>

// Wallet path: hash a registration signature into a 32-byte unwrap key
export async function deriveWalletWrapKey(signature: string): Promise<Uint8Array>

// Build the deterministic message a wallet recipient signs during registration
export function registerMessage(dropId: string): string

// Base64 helpers used at every API/DB boundary (all binary fields are base64 strings there)
export function b64(bytes: Uint8Array): string
export function unb64(s: string): Uint8Array

// Metadata minimization: encrypt the drop title (and any owner-only metadata) so the backend
// stores only ciphertext. CRITICAL UX CONSTRAINT: the dashboard decrypts MANY titles at once,
// so the title key must NOT be per-drop (that would mean one wallet-signature popup per drop).
// Derive ONE drop-independent owner title key from a single fixed-message signature
// (`deaddrop:title-key:v1`), cache it in memory for the session, and use it for all titles.
// The dropId is used only as additional context (e.g. AES-GCM additional data), not in the key.
export async function deriveOwnerTitleKey(signature: string): Promise<CryptoKey>  // sign `deaddrop:title-key:v1` once
export async function encryptTitleForOwner(title: string, titleKey: CryptoKey, dropId: string): Promise<string> // base64
export async function decryptTitleForOwner(encryptedTitle: string, titleKey: CryptoKey, dropId: string): Promise<string>
```

**No `deriveShardB` from owner wallet** — that approach was abandoned. shardB is generated fresh per drop (random 32 bytes) and wrapped per recipient. shardA is gated by drand (timelock) or the Move contract (multisig), and a copy is wrapped for the owner with their wallet signature so they can reset the timer.

**Timelock layer (`lib/timelock.ts`) — keep separate from `lib/crypto.ts`:**

```typescript
import { timelockEncrypt, timelockDecrypt, mainnetClient, roundAt } from "tlock-js"
const client = mainnetClient()  // verify current drand mainnet chainhash in drand docs

export function roundForTime(releaseAtMs: number): number
export async function timelockEncryptShardA(shardA: Uint8Array, round: number): Promise<string>
export async function timelockDecryptShardA(tlockShardA: string): Promise<Uint8Array>
  // throws if the round hasn't published yet — that's the lock working
```

`tlock-js` is Kudelski-audited. It does hybrid encryption internally, so wrapping a 32-byte shardA is cheap. Works in-browser (drand's own timevault app proves this).

### Encryption pattern: arming a drop

```typescript
import {
  generateKey, encryptBytes, fingerprintOf, exportKey,
  xorBytes, randomBytes, hkdfExpand, deriveWalletWrapKey
} from "@/lib/crypto"
import { roundForTime, timelockEncryptShardA } from "@/lib/timelock"
import { getWalletSigner, signMessage } from "@/lib/aptos"

type RecipientInput =
  | { type: "email"; id: string; email: string; backupEmail?: string }
  | { type: "wallet"; id: string; email: string; backupEmail?: string;
      walletAddress: string; registrationSignature: string }

async function armDrop(args: {
  file: File
  title: string                      // owner-facing label; encrypted client-side before upload
  titleKey: CryptoKey                // drop-independent owner title key (deriveOwnerTitleKey)
  distribution: "private" | "public"
  recipients: RecipientInput[]       // private only; [] for public
  dropId: string
  mode: "timelock" | "multisig"
  releaseAtMs?: number               // timelock only
  walletSigner: ShelbySigner         // connected wallet's signer for the Shelby upload
  contractClient?: MoveContractClient // multisig only
  keepOwnerCopy?: boolean            // default true; false = true-commitment, no reset
}) {
  const { file, distribution, recipients, dropId, mode } = args

  // 1. Encrypt the file
  const plaintext = await file.arrayBuffer()
  const key = await generateKey()
  const { ciphertext, iv } = await encryptBytes(plaintext, key)
  const fingerprint = await fingerprintOf(ciphertext)
  const keyBytes = await exportKey(key)

  // 2. Decide what gets gated. PRIVATE: split off per-recipient shardB, gate shardA.
  //    PUBLIC: no shardB; gate K itself.
  let shardB: Uint8Array | undefined
  let toGate: Uint8Array
  if (distribution === "private") {
    shardB = randomBytes(32)
    toGate = xorBytes(keyBytes, shardB)   // shardA
  } else {
    toGate = keyBytes                      // K
  }

  // 3. Gate `toGate` by condition. Raw `toGate` must NEVER reach the backend OR the chain.
  let tlockShardA: string | undefined
  let ibeHeader: string | undefined
  let contractRef: string | undefined
  let releaseRound: number | undefined
  if (mode === "timelock") {
    releaseRound = roundForTime(args.releaseAtMs!)
    tlockShardA = await timelockEncryptShardA(toGate, releaseRound)
  } else {
    // Multisig: same IBE primitive as timelock, different authority.
    // (a) Set up the signer group key (owner-dealt): generate group BLS keypair, Shamir-split
    //     the secret across the registered signers, encrypt each share to its signer, discard
    //     the master. Returns the group public key + per-signer encrypted key shares.
    // (b) IBE-encrypt toGate to identity=dropId under the group public key.
    // (c) createDrop stores group pubkey, signer BLS pubkeys, encrypted key shares, IBE header.
    const signerBlsPubkeys = /* fetched from registered signers for this drop */ [] as string[]
    const { groupPubkey, encKeyShares } = await args.contractClient!.setupSignerGroup({
      signerBlsPubkeys, threshold: /* t */ 0,
    })
    ibeHeader = await args.contractClient!.ibeEncryptToGroup({
      secret: toGate, identity: dropId, groupPubkey,
    })
    contractRef = await args.contractClient!.createDrop({
      dropId, distribution,
      signers: /* signer addresses */ [], threshold: /* t */ 0,
      groupPubkey, signerBlsPubkeys, encKeyShares, ibeHeader,
    })
  }

  // 4. Owner copy — TIMELOCK ONLY. Multisig gets NO owner copy (owner discarded the group
  //    master at setup and must not reconstruct alone). keepOwnerCopy=false also opts out.
  let ownerShardA: string | undefined
  let ownerKeyWrapped: string | undefined
  if (mode === "timelock" && args.keepOwnerCopy !== false) {
    const ownerWrapKey = await deriveWalletWrapKey(await signMessage(`deaddrop:owner:${dropId}`))
    const wrapped = xorBytes(toGate, ownerWrapKey)
    // b64() = base64 encode; all binary fields are base64 at the API/DB boundary.
    // (Use a shared helper in lib/crypto.ts: b64(Uint8Array) / unb64(string).)
    if (distribution === "private") ownerShardA = b64(wrapped)
    else ownerKeyWrapped = b64(wrapped)
  }

  // 5. PRIVATE only: wrap shardB per recipient
  const wrappedRecipients = distribution === "private"
    ? await Promise.all(recipients.map(async (r) => {
        if (r.type === "email") {
          const secret = randomBytes(32)
          const wrapKey = await hkdfExpand(secret, "deaddrop-shardB", 32)
          return { ...r, wrappedShardB: xorBytes(shardB!, wrapKey), secret }
        } else {
          const wrapKey = await deriveWalletWrapKey(r.registrationSignature)
          return { ...r, wrappedShardB: xorBytes(shardB!, wrapKey) }
        }
      }))
    : []

  // 6. Upload ciphertext to Shelby. signer = the connected wallet's signer (getWalletSigner()).
  //    NOT a private-key Account. If Shelby's SDK doesn't accept a wallet signer, use the resolved
  //    fallback (see ARCHITECTURE "Open questions to resolve BEFORE building").
  const { blobName } = await uploadCiphertext({
    signer: getWalletSigner(),
    ciphertext, blobName: `deaddrop_${dropId}`, expirationMicros: chooseExpiration(args.releaseAtMs),
  })

  // 7. POST metadata. Backend receives only gated/wrapped material — never raw toGate.
  //    Also send the client-encrypted title + encrypted recipient emails (metadata minimization).
  //    titleKey is the drop-independent owner title key (derived once via deriveOwnerTitleKey,
  //    cached for the session) — passed into armDrop so we don't trigger a per-drop signature.
  await fetch("/api/drops", {
    method: "POST",
    body: JSON.stringify({
      dropId, mode, distribution, blobName, iv, fingerprint,
      tlockShardA, ibeHeader, contractRef, releaseRound,
      ownerShardA, ownerKeyWrapped,
      encryptedTitle: await encryptTitleForOwner(args.title, args.titleKey, dropId),
      recipients: wrappedRecipients,   // emails carried encrypted; see /api/drops + email layer
      triggerAt: args.releaseAtMs,
    }),
  })
}
```

This is the canonical arming flow. ARCHITECTURE.md "Upload flow as actual code" shows the same logic; if they ever drift, ARCHITECTURE is the source of truth for the crypto and this is the implementation reference.

**Title-key handling (avoid signature-popup spam):** derive the owner title key **once** per session with `deriveOwnerTitleKey(await signMessage("deaddrop:title-key:v1"))`, cache it in the wallet Zustand store (in memory only — never persisted), and pass it into `armDrop` (add `title: string` and `titleKey: CryptoKey` to its args) and into the dashboard's title-decryption. The dashboard decrypts all drop titles with this one key — one signature, not one per drop. If the key isn't cached yet (fresh session), prompt once before rendering titles; show drops with a placeholder title until the key is available.

### Decryption pattern: recipient retrieval

```typescript
import { xorBytes, hkdfExpand, deriveWalletWrapKey, importKey, decryptBytes } from "@/lib/crypto"
import { timelockDecryptShardA } from "@/lib/timelock"

// Email recipient, time-lock drop
async function decryptEmailTimelock(args: {
  ciphertext: Uint8Array; iv: Uint8Array
  tlockShardA: string            // from the retrieve API
  wrappedShardB: Uint8Array
  urlSecret: Uint8Array          // from window.location.hash
}) {
  const shardA = await timelockDecryptShardA(args.tlockShardA)  // throws if round not yet public
  const wrapKey = await hkdfExpand(args.urlSecret, "deaddrop-shardB", 32)
  const shardB = xorBytes(args.wrappedShardB, wrapKey)
  const key = await importKey(xorBytes(shardA, shardB))
  return decryptBytes(args.ciphertext, args.iv, key)
}

// Wallet recipient, multisig drop — secret recovered via threshold-BLS/IBE (same as timelock)
async function decryptWalletMultisig(args: {
  ciphertext: Uint8Array; iv: Uint8Array
  ibeHeader: Uint8Array          // IBE ciphertext of the secret to identity=dropId
  sigShares: Uint8Array[]        // BLS signature shares over dropId, published by signers (>= t)
  wrappedShardB?: Uint8Array     // private drops only; absent for public
  dropId: string
  signFn?: (msg: string) => Promise<string>  // private wallet-recipient only
  contractClient: MoveContractClient
}) {
  // Aggregate t signature shares into the IBE decryption key for identity=dropId,
  // then IBE-decrypt the header. This is the SAME decrypt routine as timelock; only the
  // key source differs (aggregated signer signatures vs the drand beacon).
  const secret = await args.contractClient.ibeDecryptWithShares(args.ibeHeader, args.dropId, args.sigShares)

  let keyBytes: Uint8Array
  if (args.wrappedShardB && args.signFn) {
    const wrapKey = await deriveWalletWrapKey(await args.signFn(`deaddrop:register:${args.dropId}`))
    const shardB = xorBytes(args.wrappedShardB, wrapKey)
    keyBytes = xorBytes(secret, shardB)   // secret is shardA
  } else {
    keyBytes = secret                      // public: secret IS K
  }
  const key = await importKey(keyBytes)
  return decryptBytes(args.ciphertext, args.iv, key)
}
```

The four condition×distribution combinations share these building blocks; the retrieval page picks the right secret source (drand round → tlock decrypt, or aggregated signer shares → IBE decrypt) and applies the shardB unwrap only for private drops. Both secret sources feed the *same* IBE decrypt.

### Required tests (`lib/__tests__/crypto.test.ts`)

- `encryptBytes` → `decryptBytes` round-trip preserves bytes exactly
- `fingerprintOf` is stable across calls
- XOR round-trip: `xorBytes(xorBytes(a, b), b) === a`
- `hkdfExpand` deterministic for same secret+info; differs across info (domain separation)
- Email path end-to-end (with a mocked/short-round tlock): encrypt → wrap → tlock → unwrap → decrypt recovers plaintext
- Wallet path end-to-end: encrypt → wrap with signature → unwrap with same signature → decrypt
- Owner reset path: ownerShardA + owner signature recovers shardA exactly
- AES-GCM tampering: flipping one ciphertext byte → `decryptBytes` throws
- Wrong unwrap key → wrong key → `decryptBytes` throws (GCM auth fails)
- `lib/timelock.ts`: decrypting before the round publishes throws; after (use a past round in tests) succeeds
- `lib/contract.ts` (multisig BLS/IBE): with a test signer group, IBE-encrypt a secret to identity=dropId; fewer than `threshold` signature shares cannot decrypt; exactly `threshold` shares aggregate into the IBE key and recover the secret exactly; a forged/non-signer share is rejected
- Public-drop paths: timelock public (K tlock'd, recovered after round) and multisig public (K IBE'd, recovered at threshold) both round-trip with no shardB

### Step 7: Shelby integration
Create `lib/shelby.ts` — wrapper around the verified Shelby SDK.

**FIRST: verify the signer type.** Before writing this, confirm what the Shelby SDK's upload `signer` accepts (ARCHITECTURE "Open questions to resolve BEFORE building"). Every public Shelby example passes `Account.generate()` (a raw keypair). It is unverified whether it also accepts a wallet-adapter signer. Define `ShelbySigner` as the type the SDK actually expects:
- If the SDK accepts a wallet signer → `ShelbySigner` = the wallet-adapter signer / `signAndSubmitTransaction` callback. The connected Petra wallet signs uploads. (Preferred.)
- If it requires a raw `Account` → `ShelbySigner` = that, and you must resolve via the fallback in ARCHITECTURE (wallet-signer adapter, or a backend signing service that submits the upload — browser still encrypts, so confidentiality is unchanged). Do NOT fabricate a private key from the wallet.

Build against the **mock** (below) until this is confirmed; the mock lets every other step proceed.

```typescript
// ShelbySigner = whatever Shelby's SDK upload accepts. Set this to the real type after verifying.
// Do NOT assume a raw private-key Account constructed from the wallet — that cannot exist.
export type ShelbySigner = /* SDK's signer type — wallet-adapter signer preferred */ unknown

// The Shelby SDK uses blob NAMES not auto-generated IDs.
// We choose the name at upload time: `deaddrop_${dropId}`.

export async function uploadCiphertext(args: {
  signer: ShelbySigner
  ciphertext: Uint8Array
  blobName: string
  expirationMicros: number   // microseconds since epoch
}): Promise<{ blobName: string }>

export async function downloadCiphertext(
  blobName: string
): Promise<Uint8Array>

export async function listBlobs(args: {
  account: string
  limit?: number
  offset?: number
}): Promise<Array<{ name: string; size: number; expiresAt: number }>>

// Pick a blob expiration that overshoots the release time by ≥30 days (see "Default blob
// expiration" below). For timelock drops, base it on releaseAtMs; for multisig drops there's
// no fixed release time, so use a generous default (e.g. now + 1 year). Returns microseconds.
export function chooseExpiration(releaseAtMs?: number): number
```

**Use the React hooks where possible.** `@shelby-protocol/react` provides:
- `useUploadBlobs({ onSuccess, onError })` → returns `{ mutate, isPending, error }`
- `useAccountBlobs({ account, pagination })` → returns `{ data, isLoading, error }`

In components, prefer hooks for built-in loading/error state. In imperative crypto code, use the `lib/shelby.ts` wrappers.

**Default blob expiration:** overshoot the release time by at least 30 days (see ARCHITECTURE.md "Renewal logic").

```typescript
const ONE_DAY_MICROS = 86_400_000_000
const expirationMicros = Date.now() * 1000 + 30 * ONE_DAY_MICROS
```

**If the SDK isn't available** (Early Access not yet approved): build `lib/shelby.mock.ts` with the same API surface, backed by IndexedDB (not localStorage — files can exceed 5MB and localStorage will fail). Toggle via `NEXT_PUBLIC_USE_SHELBY_MOCK=true`. Add a banner to the dashboard when the mock is active.

```typescript
// lib/shelby.ts — top of file
const USE_MOCK = process.env.NEXT_PUBLIC_USE_SHELBY_MOCK === "true"
if (USE_MOCK) {
  console.warn("[Until Then] Using Shelby mock — files persist in IndexedDB only")
}
```

### Step 8: Database (Supabase)
Set up a Supabase project (free tier). Four tables, defined in `supabase/migrations/0001_initial.sql`:

```sql
create table drops (
  id text primary key,                       -- "drop_xxxx"
  owner_address text not null,
  encrypted_title text not null,             -- client-encrypted under owner's key; backend never
                                             --   learns the plaintext title (metadata minimization)
  blob_name text not null,
  iv text not null,                          -- base64
  ciphertext_fingerprint text not null,
  mode text not null check (mode in ('timelock','multisig')),
  distribution text not null check (distribution in ('private','public')),

  -- gating — exactly one path is populated. NO raw shard_a / key / secret column exists.
  -- For private drops the gated secret is shardA; for public drops it is K.
  tlock_shard_a text,                        -- timelock mode: drand-locked IBE ciphertext
  release_round bigint,                      -- timelock mode: drand round it unlocks at
  contract_ref text,                         -- multisig mode: on-chain drop reference
  ibe_header text,                           -- multisig mode: IBE ciphertext of the secret to
                                             --   identity=dropId (needs t signer BLS shares to open)

  -- owner reset material (wallet-wrapped; useless to the backend). Exactly one is set.
  owner_shard_a text,                        -- private drops: shardA XOR owner wrap key
  owner_key_wrapped text,                    -- public drops:  K XOR owner wrap key

  check_in_interval_days int,
  grace_period_days int,
  trigger_at timestamptz,                    -- chosen release time (maps to release_round)
  released_at timestamptz,                   -- set by notifier when condition observed met
  notifications_sent_at timestamptz,
  expiration_micros bigint not null,
  created_at timestamptz default now()

  -- Note: owner_shard_a (private) / owner_key_wrapped (public) are normally set so the
  -- owner can reset the timer and self-recover. They are intentionally nullable to support
  -- the optional "no owner copy" mode (true commitment; loses reset ability). See ARCHITECTURE.
);

create table recipients (
  id text primary key,                       -- "rcpt_xxxx" (private drops only)
  drop_id text not null references drops(id) on delete cascade,
  name text,
  type text not null check (type in ('email','wallet')),
  encrypted_email text not null,             -- email encrypted at rest; decryptable only by the
                                             --   notifier at send time (key in notifier env, not DB)
  encrypted_backup_email text,               -- optional, same treatment
  wallet_address text,
  wallet_chain text,
  wrapped_shard_b text not null,             -- base64
  released_at timestamptz                    -- set when this recipient's link is burned
);

create table recipient_secrets (
  recipient_id text primary key references recipients(id) on delete cascade,
  secret text not null,                      -- base64 — deleted the moment notification is sent
  created_at timestamptz default now()
);

-- Multisig drops only: the designated signers who must approve release.
-- Each registers a BLS public key (their share of the group key) so the contract can verify
-- their approval signature. Their encrypted BLS key share lives on-chain (enc to them).
create table signers (
  id text primary key,                       -- "sgnr_xxxx"
  drop_id text not null references drops(id) on delete cascade,
  name text,
  wallet_address text not null,
  wallet_chain text not null,
  bls_pubkey text,                           -- base64 — set at registration; used to verify approvals
  encrypted_email text not null,             -- for approval-request notification; encrypted at rest
  registered boolean not null default false, -- owner cannot arm until all are registered
  approved_at timestamptz                    -- cached from chain for dashboard display
);

create index drops_release_pending on drops (release_round) where released_at is null and mode = 'timelock';
create index recipients_drop on recipients (drop_id);
create index signers_drop on signers (drop_id);
```

Note the schema is **four tables**: `drops`, `recipients`, `recipient_secrets`, `signers`. (Signer encrypted BLS key shares + the IBE header live on-chain; the `signers` table only tracks who the signers are, their BLS public key, and registration/approval status for the UI.)

**There is deliberately no `shard_a`, no `key`, no `secret`, and no plaintext `title` or `email` column.** The secret is never stored raw. Secret-derived columns are `tlock_shard_a` (drand-locked IBE), `ibe_header` (signer-group IBE; needs t BLS shares to open), `owner_shard_a`/`owner_key_wrapped` (wallet-locked, timelock only), and per-recipient `wrapped_shard_b` — none usable by the backend. Titles and emails are encrypted at rest (metadata minimization).

**RLS (Row-Level Security):** enable RLS on all four tables. Policies:
- `drops`: the owner (matched by `owner_address` against a custom JWT claim) can SELECT/UPDATE their own drops. **Public drops** additionally allow anonymous SELECT of the columns `/p/[dropId]` needs (release_round, tlock_shard_a, contract_ref, ibe_header, iv, blob_name, ciphertext_fingerprint, status, mode, distribution) — safe to expose because the drand/contract gate protects the content. (encrypted_title is not needed by `/p` and need not be exposed.) Private drops have no anonymous read; retrieval goes through the server-side `/api/retrieve` route only.
- `recipients`: only the owner of the parent drop can SELECT/UPDATE. No anonymous access. `encrypted_email` is readable by the owner (for their dashboard) and the service role (for the notifier); it's ciphertext either way.
- `recipient_secrets`: NO client access. Service-role key only.
- `signers`: the owner can SELECT/UPDATE/INSERT their drop's signers. A signer registering reads/updates their own row via a one-time registration token. `bls_pubkey` is owner-readable.

`lib/db.ts` exports two clients:

```typescript
// Browser client — anon key, RLS-enforced
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Server-only client — service role key, bypasses RLS
// NEVER import this from a component or expose it to the browser
export function serverSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
```

If `lib/db.ts` is ever imported into a `"use client"` component and uses `serverSupabase()`, Next.js will throw at build time — this is the desired behavior.

### Step 9: API routes
Create these Next.js Route Handlers under `app/api/`. All use the server-side Supabase client.

**`app/api/drops/route.ts` — POST: create a drop**

```typescript
// Validates request body (use zod). Branches on distribution:
//   - private: inserts into drops + recipients (+ recipient_secrets for email recipients)
//   - public:  inserts into drops only; recipients array must be empty
//   - multisig: also inserts signers (already registered with their BLS pubkeys)
// Stores only gated/wrapped material — REJECT any payload containing a raw shardA or raw K.
// (Add an explicit validation: tlock_shard_a OR (ibe_header + contract_ref) present; reject any
//  field named shard_a / key / secret / W.)
// The client sends the title ALREADY ENCRYPTED (encryptedTitle) — store it as encrypted_title.
// Recipient/signer email addresses arrive in plaintext from the owner's browser; the route
// ENCRYPTS each under EMAIL_ENC_KEY (server-only) before storing as encrypted_email. Never
// store a plaintext email. (The notifier later decrypts with the same key at send time.)
// Returns { dropId } on success.
// Auth: requires a signed challenge from the owner's wallet (verify against owner_address).
```

**`app/api/retrieve/[dropId]/[recipientId]/route.ts` — GET: claim a PRIVATE drop**

```typescript
// Single atomic SQL operation that does ALL of:
//   1. Verify the drop has been released (drops.released_at IS NOT NULL — notifier confirmed
//      the drand round published, or the contract fired)
//   2. Verify within the 7-day expiry window
//   3. Verify this recipient hasn't already claimed (recipients.released_at IS NULL)
//   4. Set the recipient's released_at = now() in the SAME query (atomic burn)
//   5. Return the gated material + wrapped shardB + blob info
//
// SQL pattern:
//   UPDATE recipients r SET released_at = now()
//   FROM drops d
//   WHERE r.id = $recipientId AND r.drop_id = $dropId
//     AND r.released_at IS NULL
//     AND d.distribution = 'private'
//     AND d.released_at IS NOT NULL
//     AND d.released_at + interval '7 days' > now()
//   RETURNING r.wrapped_shard_b,
//             d.tlock_shard_a, d.contract_ref, d.ibe_header, d.release_round,
//             d.iv, d.blob_name, d.ciphertext_fingerprint, d.mode
//
// If RETURNING is empty: 410 Gone, same message regardless of which condition failed.
// The response NEVER contains a usable secret — tlock_shard_a needs the published round;
// ibe_header needs t signer BLS signature shares (read+aggregated from the contract) to open.
```

Why conditions aren't revealed: an attacker probing the API shouldn't distinguish "already used" / "expired" / "not released" / "doesn't exist". Always return the same 410: "This link is no longer valid."

Defense-in-depth: even with a bug returning data early, the recipient still can't decrypt — the timelock won't open until the round publishes, and the contract yields nothing until release. The API gate is convenience; the cryptographic gate is the real control.

**`app/api/public/[dropId]/route.ts` — GET: PUBLIC drop metadata (no burn, no auth)**

```typescript
// For public drops only. Returns the data the self-unlocking page needs:
//   { distribution: 'public', mode, release_round, contract_ref, tlock_shard_a,
//     iv, blob_name, ciphertext_fingerprint, status }
// No burn, no single-use, no expiry — public drops are intentionally multi-use after release.
// Safe to return tlock_shard_a unconditionally: it only opens once the drand round publishes,
// which is exactly the intended behavior. For multisig public drops, the page reads release
// state from the contract.
// Return 404 only if the drop doesn't exist or isn't public.
```

**`app/api/drops/[dropId]/reset/route.ts` — POST: atomic timer reset (timelock drops)**

```typescript
// Body: { tlockShardA, releaseRound, triggerAt, expectedOldRound }
// The owner's browser has already recovered shardA/K via wallet signature and re-timelocked.
// This route just swaps the stored ciphertext ATOMICALLY with optimistic concurrency:
//   UPDATE drops
//   SET tlock_shard_a = $tlockShardA, release_round = $releaseRound, trigger_at = $triggerAt
//   WHERE id = $dropId
//     AND release_round = $expectedOldRound   -- guards against concurrent/stale resets
//     AND released_at IS NULL                  -- cannot reset an already-released drop
//   RETURNING id
// If RETURNING is empty: the drop already released or another reset won the race → 409 Conflict.
// Auth: owner wallet challenge.
```

**`app/api/register/[dropId]/[recipientId]/route.ts` — POST: wallet recipient pre-registration**

```typescript
// Body: { walletAddress, registrationSignature, registrationMessage }
// Verify the signature is valid for the wallet on the appropriate chain (lib/aptos verifySignature)
// Verify the message matches `deaddrop:register:${dropId}`
// Store the signature so the owner can compute wrappedShardB
// Mark recipient as registered
```

**`app/api/register-signer/[dropId]/[signerId]/route.ts` — POST: multisig signer pre-registration**

```typescript
// Body: { walletAddress, blsPubkey, proofSignature, message }
// For multisig drops only. The signer establishes their BLS public key (their share of the
// signer-group key) so the contract can later verify their approval signature, and so the
// owner can include them in the group-key dealing.
// Verify proofSignature over message `deaddrop:signer:${dropId}` against walletAddress (so a
// stranger can't register a bogus key for someone else's signer slot).
// Verify blsPubkey is well-formed and bound to the wallet (signer signs the blsPubkey).
// Store bls_pubkey, set registered = true.
// The owner cannot arm the multisig drop until every signer row has registered = true.
// (The owner then deals the group key: generates the group BLS keypair, Shamir-splits the
//  secret across these signers, encrypts each share to its signer, discards the master.
//  Encrypted key shares + group pubkey go on-chain via createDrop.)
```

### Step 10: Email layer (Resend)
Sign up for Resend, verify the project's domain. Add the API key to `.env.local` as `RESEND_API_KEY` (server-only).

Two templates in `lib/email-templates/`, written with `@react-email/components`:

- `recipient-email.tsx` — for email recipients. Body explains what Until Then is, who sent the file, the 7-day window, the one-time link. Button with the URL containing the secret in the fragment.
- `recipient-wallet.tsx` — same structure, different body paragraph noting wallet signature is required.
- `signer-register.tsx` — asks a multisig signer to register (connect wallet, provide encryption key). Links to `/register-signer/...`.
- `signer-approve.tsx` — asks a multisig signer to approve a release (decrypt their share and publish it). Links to `/approve/...`.

`lib/email.ts` exports:

```typescript
export async function sendRetrievalEmail(args: {
  to: string                   // primary or backup email
  recipientName?: string
  ownerName: string            // e.g. "Sarah Chen"
  dropTitle?: string           // NOT included in email body for privacy
  triggerDate: Date
  retrievalUrl: string         // full URL including fragment for email-type
  recipientType: "email" | "wallet"
}): Promise<{ id: string }>

export async function sendRegistrationEmail(args: {
  to: string
  ownerName: string
  registrationUrl: string      // /register/[dropId]/[recipientId]
}): Promise<{ id: string }>

// Multisig signer notifications
export async function sendSignerRegistrationEmail(args: {
  to: string
  ownerName: string
  registerUrl: string          // /register-signer/[dropId]/[signerId]
}): Promise<{ id: string }>

export async function sendSignerApprovalRequestEmail(args: {
  to: string
  ownerName: string
  approveUrl: string           // /approve/[dropId]/[signerId]
}): Promise<{ id: string }>
```

**Privacy rule: do not include the drop title in the email body.** The title is the owner's label and may contain sensitive context ("Estate documents", "Emergency disclosure"). Use generic phrasing: "a file Sarah Chen set aside for you." Note the title is also encrypted at rest (the backend can't read it even if it wanted to — see metadata minimization).

**Emails encrypted at rest.** Recipient/signer email addresses are stored encrypted (`encrypted_email`). The notifier decrypts them in memory at send time using a key held in its environment (`EMAIL_ENC_KEY`, server-only), never written to the DB. A database dump does not reveal who the recipients are.

**Sender identity:**
```
From: "Sarah Chen via Until Then" <notifications@untilthen.xyz>
Reply-To: support@untilthen.xyz
```

Plain-text fallback is required for every email — Resend will use it if HTML rendering fails on the recipient's client.

### Step 11: Release notifier (scheduled job)
Create `app/api/cron/release/route.ts`. It does NOT decide releases by clock time alone — it confirms the *actual* release condition is met, then notifies. Protected by `CRON_SECRET` (`Authorization: Bearer ${CRON_SECRET}`).

```typescript
export async function GET(req: Request) {
  // 1. Verify CRON_SECRET header
  // 2. Find candidate drops: released_at IS NULL, and either:
  //    - mode='timelock' AND release_round <= current drand round (fetch latest round from drand)
  //    - mode='multisig' AND the Move contract reports released==true for contract_ref
  // 3. For each genuinely-released drop:
  //    a. UPDATE drops SET released_at = now() WHERE id = ? AND released_at IS NULL
  //       RETURNING * — idempotent guard against concurrent runs
  //    b. IF distribution='public': stamping released_at is ALL that's needed.
  //       The /p page self-unlocks via drand/contract; no email, no recipients. Skip to next drop.
  //       (We stamp released_at mainly for dashboard status; the page doesn't depend on it.)
  //    c. IF distribution='private':
  //       - SELECT recipients LEFT JOIN recipient_secrets ON r.id = s.recipient_id WHERE drop_id = ?
  //         LEFT JOIN is mandatory: wallet recipients have no secrets row; INNER JOIN drops them.
  //       - For each recipient:
  //           type='email' (secret present): URL with secret in fragment
  //           type='wallet': URL with no fragment
  //           send to primary email; if backup_email set, send identical second email
  //       - DELETE FROM recipient_secrets WHERE recipient_id IN (...)
  //       - UPDATE drops SET notifications_sent_at = now() WHERE id = ?
  // 4. Return { released: N, emails_sent: M }
}
```

**The two release oracles:**
- drand current round: fetch from a drand HTTP endpoint (the `tlock-js` client can compute the current round, or hit the drand API directly). Compare to `release_round`.
- Move contract: read the drop's `released` flag via the Aptos SDK for multisig drops.

Critically, this job only ever flips a notification flag and sends email. It cannot cause a decryption that the cryptography wouldn't already permit: a timelock drop's shardA is recoverable by anyone once the round publishes (that's the point), and a multisig drop's shardA is released by the contract, not by this job.

Schedule in `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/release", "schedule": "0 * * * *" }]
}
```

**Vercel Cron tier note:** Vercel's Hobby plan limits cron to **daily** frequency and 2 jobs total. Hourly cron requires the Pro plan ($20/month per member). If we want hourly without Vercel Pro, alternatives are:
- **Supabase pg_cron** (free) — runs scheduled SQL queries; combine with `pg_net` extension to call our API route from inside Postgres
- **Upstash QStash** (free tier 500 messages/day) — call our API on any schedule we want
- **GitHub Actions cron** (free) — schedule a workflow that hits our endpoint with the CRON_SECRET

For launch, Supabase pg_cron is the natural fit since we already use Supabase. Daily cron via Vercel Hobby is acceptable for early testing but means release-notification latency up to 24 hours. Note this latency only delays the *email* — for timelock drops a technical recipient can retrieve as soon as the drand round publishes, regardless of when our email goes out.

The hourly cadence means notification latency up to 1 hour. Acceptable — not a real-time system. Confidentiality never depends on this job running on time.

### Step 12: Move contract
The contract ships at launch — it is not optional. Read the "Aptos / Move integration" section of ARCHITECTURE.md for the full construction. It does two jobs:

1. **On-chain audit anchor for all drops** — records drop id, owner, mode, timestamps.
2. **Threshold-gated release for multisig drops** — via threshold BLS / IBE, the SAME primitive as timelock, with the signer group as the IBE authority instead of drand.

**The construction (reuses the timelock IBE path — do NOT hand-roll a separate VSS scheme).** The secret (shardA for private, K for public) is IBE-encrypted to identity = `dropId` under the signer group's BLS public key. Each signer holds a share of the group's BLS secret key (dealt at registration, master discarded by the owner). To approve, a signer publishes a **BLS signature share over `dropId`**; the contract BLS-verifies it against that signer's registered BLS public key. Once `threshold` signature shares exist, anyone aggregates them into the IBE decryption key for `dropId` and runs the **same IBE decrypt as timelock** to recover the secret. Nothing decryptable is ever on-chain: the IBE header needs the identity key, and sub-threshold BLS shares reveal nothing.

This is why it's safer than a bespoke VSS: a BLS signature share is self-verifying against a known public key (no Feldman/Pedersen commitments to implement), and there's one shared IBE decrypt path with the audited timelock route.

Build `contracts/untilthen/sources/UntilThen.move` with: `create_drop` (stores group pubkey, per-signer BLS pubkeys, encrypted key shares, IBE header for multisig), `approve_release(drop_id, sig_share)` (BLS-verifies the share against the signer's pubkey, records it, flips `released` at threshold), `get_release_material` (returns `released` + the published signature shares), `record_reset` (timelock audit trail). Use Aptos's native BLS12-381 for on-chain verification. Write Move unit tests for: threshold logic, BLS signature-share verification, rejection of shares from non-signers, and that pre-threshold state reveals nothing decryptable. Deploy to Aptos testnet; put the address in `NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS`.

Create `lib/contract.ts` — a typed client wrapping Aptos SDK calls + the client-side BLS/IBE crypto (use `@noble/curves` BLS12-381, sharing the IBE routines with `lib/timelock.ts` where possible):
- `setupSignerGroup({ signerBlsPubkeys, threshold })` → `{ groupPubkey, encKeyShares }` (owner-dealt at arm: generate the group BLS keypair, Shamir-split the secret key across signers, encrypt each share to its signer, discard the master). Later: replace with interactive DKG for full trustlessness.
- `ibeEncryptToGroup({ secret, identity, groupPubkey })` → `ibeHeader` (same IBE encrypt as tlock, group authority)
- `createDrop({ dropId, distribution, signers, threshold, groupPubkey, signerBlsPubkeys, encKeyShares, ibeHeader })`
- `signApproval({ dropId, myEncKeyShare, walletSignFn })` → `sigShare` (signer decrypts their key share, produces a BLS signature share over dropId)
- `approveRelease(dropId, sigShare)` (publishes the share; contract BLS-verifies)
- `getReleaseMaterial(dropId)` → `{ released, sigShares }`
- `ibeDecryptWithShares(ibeHeader, identity, sigShares)` → `Uint8Array` (aggregate ≥ threshold shares → IBE key → decrypt)

Key crypto decisions to nail down (and get reviewed — this is still the most security-critical code, but it is now the *same family* as the audited timelock path, not novel composition):
- **BLS domain separation.** The signature-share message for multisig (`dropId`) must use a domain-separation tag distinct from drand's, so a signer signature can never be confused with a beacon signature.
- **Group-key dealing.** Owner-dealt Shamir over the BLS scalar field at launch; document that the owner briefly holds the master (acceptable — owner had the plaintext). Plan DKG as the trustless upgrade.
- **Reuse, don't reinvent.** Wherever the IBE encrypt/decrypt can call the same code as `lib/timelock.ts`, do so — divergent IBE implementations are an avoidable risk.

Wallet note: signers approving need to sign Aptos transactions (to publish their share). At launch only Aptos/Petra signers are wired; Solana/EVM signers are "Coming soon."

### Step 13: Drop store (client-side cache)
Create `store/drops.ts` using Zustand with localStorage persistence. This is just a **cache of the user's own drops** for fast dashboard rendering. The source of truth is Supabase + the chain.

```typescript
import { create } from "zustand"
import { persist } from "zustand/middleware"

type DropsStore = {
  drops: Drop[]                              // own drops, fetched from API
  setDrops: (drops: Drop[]) => void
  upsertDrop: (drop: Drop) => void
  getDrop: (id: string) => Drop | undefined
}
```

The store holds drop metadata (title, status, triggerAt, recipient count) but **never crypto material** — no shardA, no tlockShardA, no secrets.

### Step 14: App providers
Wire up `app/layout.tsx` with all required providers, **in this nesting order** (outer to inner):

```tsx
<QueryClientProvider>            {/* required by @shelby-protocol/react */}
  <ShelbyClientProvider>         {/* from @shelby-protocol/react */}
    <AptosWalletAdapterProvider> {/* from @aptos-labs/wallet-adapter-react */}
      <WalletStateProvider>      {/* our own — syncs adapter state to Zustand */}
        {children}
      </WalletStateProvider>
    </AptosWalletAdapterProvider>
  </ShelbyClientProvider>
</QueryClientProvider>
```

The exact import paths and configuration props for `ShelbyClientProvider` should be taken from the Shelby React SDK docs at https://docs.shelby.xyz/sdks/react — do not guess. If unclear, ask before writing code.

### Step 15: Pages and screens
Build pages in this order — each one is complete before moving to the next:

1. `app/page.tsx` — Landing
2. `app/dashboard/page.tsx` — Drops list (fetches from API on mount)
3. `app/new/encrypt/page.tsx` — Upload + encrypt
4. `app/new/condition/page.tsx` — Condition setup: pick **distribution** (private/public) AND **mode** (timelock/multisig). Both timelock and multisig functional at launch.
5. `app/new/confirm/page.tsx` — Private: recipients (email vs wallet toggle). Public: show the shareable link + the irreversibility confirmation. Then arm.
6. `app/drop/[id]/page.tsx` — Drop detail + reset (re-timelocks via owner signature; disabled after release)
7. `app/register/[dropId]/[recipientId]/page.tsx` — Wallet recipient pre-registration
8. `app/register-signer/[dropId]/[signerId]/page.tsx` — Multisig signer pre-registration (connect wallet, establish BLS public key for the signer group)
9. `app/approve/[dropId]/[signerId]/page.tsx` — Multisig signer approval: connect wallet, decrypt own share, publish it on-chain via `approve_release`. Shows approval progress (n of threshold).
10. `app/r/[dropId]/[recipientId]/page.tsx` — Private recipient retrieval (all four path combinations)
11. `app/p/[dropId]/page.tsx` — Public retrieval: live countdown before release, self-unlock + decrypt after (fetches drand round / reads contract directly; backend not required for decryption)
12. `app/security/page.tsx` — Security model page (threat model in plain language)

For each page: match the Claude Design output precisely. The retrieval pages (`/r`, `/p`), the signer pages (`/register-signer`, `/approve`), and the security page are *new* relative to the original design — build them from the existing component vocabulary.

**Multisig flow note:** a multisig drop involves signers acting at two moments — registration (before arm, providing their encryption pubkey) and approval (after the owner shares the approval link / the drop is active, decrypting their share and publishing it). Both need email notification to the signers; reuse the email layer with signer-specific templates, or generalize the existing templates. Signers are notified to *approve*; recipients are notified to *retrieve*.

**Public drop UX requirement (step 5):** before arming a public drop, the user must pass an explicit confirmation: *"Anyone who gets this link will be able to open the file after [date]. You can delay it by checking in, but once you share the link you cannot un-publish it."* A checkbox, not just text. This is the single most important guardrail for the public mode — do not skip it.

---

## What NOT to build (out of scope at launch)

- **No Phantom or MetaMask** recipient wallets — show "Coming soon"; Aptos/Petra only at launch
- **No k-of-n recipient backup shards** (n > 2) — would need real Shamir; XOR 2-of-2 only for now
- **No `tweaks-panel.jsx`** — that's a Claude Design tool, not app code
- **No notification channels beyond email** — primary + backup email only; no SMS, no push
- **No autonomous Shelby blob renewal** — set generous expiration at upload (overshoot the release time by ≥30 days)
- **No drop title in emails** — privacy; use generic copy
- **No reproducible-build / browser-extension client** — a real future hardening item for high-threat users, but not launch scope

**Not on this list:** the Move contract, drand timelock, and the no-custody key model. Those are core and ship at launch. There is no "stub the security now, fix later" item — weakening the custody model is never acceptable.

---

## Code conventions

### File naming
- Components: `PascalCase.tsx`
- Lib modules: `camelCase.ts`
- Pages: `page.tsx` (Next.js convention)
- Types: `types/index.ts` or co-located `*.types.ts`

### Component structure
```typescript
// Always in this order:
// 1. Imports
// 2. Types/interfaces for this component
// 3. Component function
// 4. Sub-components (if small and tightly coupled)
// 5. Default export

export default function DropRow({ drop, onReset }: DropRowProps) {
  // ...
}
```

### Error handling
User-facing errors must use human language, not technical messages. Never show stack traces or SDK error codes to users. Log full errors to console for debugging.

```typescript
// Bad
throw error.message // "ShelbySDK: blobId not found in chunkset registry"

// Good
setError("We couldn't find that file. It may have expired or been deleted.")
console.error("[shelby] downloadBlob failed:", error)
```

### Async operations in components
All async operations that update UI must handle three states: loading, success, error. Use a local `status` state:

```typescript
const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
```

---

## Running the project

```bash
npm install
npm run dev        # localhost:3000

npm run test       # unit tests (lib/crypto.ts especially)
npm run build      # production build check — run before calling launch ready
```

---

## Definition of done for launch

Launch is ready when:

**The core invariant holds (check this first)**
- [ ] A full dump of the Supabase database does NOT permit decrypting any drop (no raw shardA/K anywhere; only tlock-locked, contract-held, or wallet-wrapped material)
- [ ] Verified by an explicit test: take a DB snapshot of an armed timelock drop whose round hasn't published (test both a private and a public drop), attempt decryption with only DB contents → must fail
- [ ] Raw shardA / raw K never appears in any network request to our backend (inspect the `/api/drops` payload); the route rejects payloads containing such fields

**Frontend**
- [ ] All 12 pages render and match the design (landing, dashboard, encrypt, condition, confirm, drop detail, recipient register, signer register, signer approve, private `/r`, public `/p`, security)
- [ ] Condition step lets the user choose distribution (private/public) and mode (timelock/multisig)
- [ ] Funding check on connect detects insufficient APT/ShelbyUSD and prompts faucet
- [ ] Upload cost preview shown on confirm screen before "Arm drop"
- [ ] Private: recipient form supports both email and wallet types; wallet recipients block "Arm drop" until pre-registered
- [ ] Public: confirm screen shows the shareable link AND a friction-ful irreversibility confirmation checkbox before arming
- [ ] Private retrieval page handles all four combinations (email/wallet × timelock/multisig); one-time warning + checkbox; refreshing after use shows "link used"
- [ ] Public retrieval page shows a live countdown before release and self-unlocks + decrypts after, without requiring the backend for decryption
- [ ] Multisig: all signers must register an encryption pubkey before "Arm drop" is enabled
- [ ] Multisig: signer approval page lets a signer decrypt their share and publish it on-chain; UI shows approval progress (n of threshold)
- [ ] Condition step makes the timelock-vs-multisig semantics clear (timelock = auto-release if inactive; multisig = release only when signers actively approve)
- [ ] Security page explains the threat model in plain language, including what a public timelock does and does NOT prove

**Crypto & timelock**
- [ ] Files encrypted with AES-256-GCM in browser; plaintext never leaves the tab
- [ ] Per-recipient shardB wrapping works for email and wallet paths (private drops)
- [ ] Public drops timelock-encrypt the whole key K (no shardB) in the browser before upload
- [ ] Time-lock drops: gated material timelock-encrypted with `tlock-js` in the browser before upload
- [ ] Decrypting a timelock drop before its drand round throws; after the round, succeeds
- [ ] Owner reset re-timelocks to a new round using only the owner's wallet signature, atomically (optimistic-concurrency guard); reset is rejected after release (409) and hidden in the UI
- [ ] SHA-256 fingerprint verified at retrieval before decryption
- [ ] AES-GCM tampering: flipping one ciphertext byte causes loud failure
- [ ] All required `lib/__tests__/crypto.test.ts` and `lib/__tests__/timelock.test.ts` cases pass

**Move contract**
- [ ] Contract deployed to Aptos testnet; address in env
- [ ] Multisig uses threshold BLS / IBE (same primitive as timelock): secret IBE-encrypted to identity=dropId under the signer-group key; release = t signer BLS signature shares aggregated into the IBE key. Raw secret NEVER on-chain.
- [ ] Verified: reading raw chain/struct state before threshold reveals only the IBE header + sub-threshold BLS shares (test a private and a public multisig drop) → cannot decrypt
- [ ] `approve_release` BLS-verifies each signature share against the signer's registered pubkey; rejects non-signer or malformed shares; flips `released` at threshold
- [ ] Owner cannot reconstruct a multisig drop alone (no owner copy stored) — verified by test
- [ ] Signer pre-registration collects an encryption pubkey; arming a multisig drop is blocked until all signers registered
- [ ] Move unit tests cover threshold logic, commitment verification, and pre-threshold secrecy
- [ ] All drops recorded on-chain for the audit trail

**Backend (notifier only)**
- [ ] Supabase tables created with RLS; service-role key server-only; NO `shard_a`/`key` column exists
- [ ] `POST /api/drops` validates ownership; rejects any payload containing a raw shardA or raw K; enforces empty recipients for public drops
- [ ] `GET /api/retrieve/...` (private) burns the link atomically; second call returns 410; returns only locked material
- [ ] `GET /api/public/...` returns public-drop metadata with no burn/expiry; only safe gated columns
- [ ] `POST /api/drops/[dropId]/reset` swaps timelock ciphertext atomically with an optimistic-concurrency guard; returns 409 if already released or on race
- [ ] 7-day expiry enforced on private retrieval (public links intentionally never expire)
- [ ] `POST /api/register/...` verifies signature server-side
- [ ] Release notifier confirms the ACTUAL condition (drand round published / contract released) before acting — never time alone
- [ ] Notifier emails private recipients only; public drops just get `released_at` stamped (no email)
- [ ] Notifier protected by `CRON_SECRET`; idempotent across concurrent runs
- [ ] LEFT JOIN used for recipient/secret query (wallet recipients not dropped)

**Email**
- [ ] Resend integrated; domain verified with SPF, DKIM, DMARC
- [ ] Both templates render; plain-text fallback present; drop title never included
- [ ] Backup email receives the same link when configured

**Availability / resilience**
- [ ] Manual retrieval documented: a released timelock drop is retrievable even if our backend is down (drand round + recipient secret/wallet, or just the public link)
- [ ] Public drops verified to decrypt with the backend fully offline (drand + Shelby only)

**Shelby / wallet**
- [ ] **Verified before building the upload path:** what Shelby's SDK upload `signer` accepts (wallet-adapter signer vs raw `Account`), per ARCHITECTURE "Open questions to resolve BEFORE building". `ShelbySigner` set to the real type. No `getAccountFromWallet()` anywhere.
- [ ] Real file uploads to Shelby shelbynet (or mock if SDK unavailable, with a banner)
- [ ] Petra connects and signs uploads via the wallet adapter (or the resolved fallback if the SDK requires a raw account); the app never holds the user's private key

**Metadata minimization**
- [ ] Drop titles encrypted client-side; backend stores only `encrypted_title` (verify the plaintext title never appears in any API payload or DB row)
- [ ] Recipient/signer emails stored as `encrypted_email`; decrypted only in the notifier at send time via `EMAIL_ENC_KEY`
- [ ] A DB dump reveals no titles and no recipient identities — only that drops exist, approximate release timing, and party counts

**Verifiable delivery**
- [ ] Production build emits Subresource Integrity (SHA-384) hashes for all bundles
- [ ] Build is reproducible and the deployed hashes are published (repo + a public append-only log)
- [ ] Security page documents how a user verifies the served code matches the published source

**Code quality**
- [ ] `npm run build` passes with zero type errors and zero `any`
- [ ] All four React providers wired in correct nesting order
- [ ] `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `EMAIL_ENC_KEY` never in client bundles

**Before public launch with real users**
- [ ] `lib/crypto.ts`, `lib/timelock.ts`, and `lib/contract.ts` (+ the Move module) independently reviewed by someone competent in cryptography — the multisig threshold-BLS/IBE path especially, though it is now the same family as the audited timelock path rather than novel composition
- [ ] README + security page published; honest about residual risks (frontend delivery trust — now verifiable/detectable, recipient email compromise, residual metadata, quantum)

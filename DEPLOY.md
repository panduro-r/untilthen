# Deploying Until Then to Vercel (untilthen.xyz)

The app is a standard Next.js 16 app — it deploys to Vercel with no special build config. The
browser timelock path (tlock-js / Buffer) is verified to work in-browser, and the API routes run on
the Node.js runtime (which Supabase, the Aptos SDK, and tlock-js need).

## 1. Get the code to Vercel

Either:
- **GitHub (recommended):** push this repo to a GitHub repo, then "Import Project" in Vercel. `.env.local`
  is gitignored, so no secrets are committed. Auto-deploys on push.
- **CLI:** `npm i -g vercel && vercel` from this directory (links + deploys from local).

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)

Set all of these. `NEXT_PUBLIC_*` are exposed to the browser; the rest are server-only — never prefix
them `NEXT_PUBLIC_`.

```
NEXT_PUBLIC_APTOS_NETWORK=shelbynet         # wallet pays + signs on Shelbynet; Petra must be on it
NEXT_PUBLIC_SHELBY_NETWORK=shelbynet
NEXT_PUBLIC_USE_SHELBY_MOCK=false           # real Shelbynet (wallet-paid). "true" = IndexedDB mock
NEXT_PUBLIC_SHELBY_MAX_BLOB_HOURS=48
NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS=0xd758b474abfd383c1bae7a41c5a081052bac4ffe514e37dfd485205e433f6cb0
NEXT_PUBLIC_APP_URL=https://untilthen.xyz
NEXT_PUBLIC_SUPABASE_URL=<from Supabase → Settings → API>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>

# No Shelby uploader key: in the wallet-paid model the user's wallet signs + pays the upload, and
# download is signer-less. There is no server uploader account.

SUPABASE_SERVICE_ROLE_KEY=<service_role key>      # SERVER-ONLY
EMAIL_ENC_KEY=<32 bytes hex/base64>               # `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
CRON_SECRET=<random>                              # `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
AUTH_SESSION_SECRET=<random>                      # signs SIWA session cookies — `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

# Email — add once your sending domain is verified in Resend:
RESEND_API_KEY=
EMAIL_FROM=notifications@untilthen.xyz
EMAIL_REPLY_TO=support@untilthen.xyz
```

> Reuse the `EMAIL_ENC_KEY` and `CRON_SECRET` you already generated locally, so values match across
> environments. The notifier only sends email when `RESEND_API_KEY` is set — until then it no-ops
> safely.

## 3. Domain

Vercel → Project → Settings → Domains → add `untilthen.xyz` (and `www`), then point your registrar's
DNS at Vercel as instructed. `NEXT_PUBLIC_APP_URL` should match (`https://untilthen.xyz`) so email and
public-drop links are correct.

## 4. Database

The four migrations are already applied to the live Supabase project. If you ever recreate the
project, apply `supabase/migrations/000{1,2,3,4}*.sql` in order (Supabase SQL editor, or
`SUPABASE_DB_URL=… node scripts/migrate.mjs`).

## 5. Cron (release notifier)

`vercel.json` schedules `GET /api/cron/release` **daily** (`0 9 * * *`) — the Hobby plan's limit.
Vercel automatically sends `Authorization: Bearer $CRON_SECRET` to cron invocations, which the route
checks. Daily latency only delays the *email*; a recipient can retrieve the moment the drand round
publishes regardless. For lower latency: Vercel **Pro** allows hourly (`0 * * * *`), or run Supabase
**pg_cron** to hit the endpoint hourly for free.

## 6. After deploy — smoke check

- Landing + `/security` load.
- Connect Petra (on the same network as `NEXT_PUBLIC_APTOS_NETWORK`), arm a time-lock drop, and
  retrieve it. (This is the real end-to-end check the headless tests can't do.)
- Trigger the cron once manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://untilthen.xyz/api/cron/release`.

## Notes

- The DeadDrop Move contract is deployed to **Shelbynet** at `0xd758…`. If Shelbynet resets, re-deploy
  per `contracts/deaddrop/DEPLOYMENT.md` and update `NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS`.
- The Shelby mock stores blobs in the browser's IndexedDB, so cross-device retrieval needs the real
  Shelby network; time-lock/multisig logic is fully exercised regardless.

## 7. Shelby storage — the wallet-paid model

Storage is **owned and paid by the user's wallet** (Shelby's model — no server subsidy). An upload,
all client-side (`lib/shelby.real.ts`):

1. `generateCommitments(ciphertext)` → merkle root (in-browser erasure coding)
2. the **owner wallet** signs + pays the `register_blob` Aptos transaction on Shelbynet
3. `putBlob(account = wallet address, ciphertext)` — address-only, no private key

Blobs are namespaced by the owner's wallet address, so **download is signer-less** and recipient (`/r`)
/ public (`/p`) retrieval needs no backend. The funding modal tops up the connected wallet via the
Shelby SDK faucets (APT for gas + ShelbyUSD for storage). A gated wallet-path round-trip test lives in
`lib/__tests__/shelby-real.test.ts` (`RUN_SHELBY=1`). To use the IndexedDB mock instead (no tokens),
set `NEXT_PUBLIC_USE_SHELBY_MOCK=true`.

### Blob expiration (important on Shelbynet)

Shelbynet caps each blob's lifetime at **48 hours** (extendable +48h per `increase_expiration_time`,
which only the owner's wallet can call). `chooseExpiration` caps the initial expiration at the network
limit (`NEXT_PUBLIC_SHELBY_MAX_BLOB_HOURS`, default 48) in real mode.

> **Demo within 48h.** A drop should release inside the 48h window so it's retrievable without the
> owner returning to renew. Longer locks are exactly what **testnet** (no 48h cap) unblocks — this is
> the "needs longer retention" integration Shelby invites builders to apply for.

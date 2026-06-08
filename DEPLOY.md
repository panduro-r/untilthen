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
NEXT_PUBLIC_APTOS_NETWORK=devnet            # devnet for now; switch to testnet when you have tokens
NEXT_PUBLIC_SHELBY_NETWORK=shelbynet
NEXT_PUBLIC_USE_SHELBY_MOCK=true            # "false" once the uploader account (below) is funded
NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS=0x6b9735ae28dc3eb5d901ba89a64239c374f9334d0523c34a497f46ebe77e5fc4
NEXT_PUBLIC_APP_URL=https://untilthen.xyz
NEXT_PUBLIC_SUPABASE_URL=<from Supabase → Settings → API>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>

# Shelby real mode (only needed when NEXT_PUBLIC_USE_SHELBY_MOCK=false):
NEXT_PUBLIC_SHELBY_UPLOADER_ADDRESS=<uploader account address>   # download namespace
SHELBY_UPLOADER_PRIVATE_KEY=<uploader Ed25519 key>               # SERVER-ONLY (signs+pays uploads)

SUPABASE_SERVICE_ROLE_KEY=<service_role key>      # SERVER-ONLY
EMAIL_ENC_KEY=<32 bytes hex/base64>               # `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
CRON_SECRET=<random>                              # `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`

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

- Devnet resets ~weekly, which wipes the deployed contract — re-deploy per
  `contracts/deaddrop/DEPLOYMENT.md` and update `NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS`. Multisig is
  unaffected for time-lock-only use.
- The Shelby mock stores blobs in the browser's IndexedDB, so cross-device retrieval needs the real
  Shelby network; time-lock/multisig logic is fully exercised regardless.

## 7. Switching Shelby to the real network

The `@shelby-protocol/sdk` is wired (`lib/shelby.real.ts` + `/api/shelby/upload`). To go live:

1. Create a dedicated **uploader** Aptos account (the blob namespace + payer). Keep its key out of git.
2. Fund it on Shelbynet with APT + ShelbyUSD via the faucet (`docs.shelby.xyz/apis/faucet/shelbyusd`)
   — gated during Early Access, so this waits on the team's Discord approval.
3. Set `SHELBY_UPLOADER_PRIVATE_KEY` (server-only) and `NEXT_PUBLIC_SHELBY_UPLOADER_ADDRESS`, then
   flip `NEXT_PUBLIC_USE_SHELBY_MOCK=false`.

Architecture: the browser encrypts the file and POSTs only the **ciphertext** to `/api/shelby/upload`,
which signs+pays the upload with the uploader account (Shelby's SDK needs a raw `Account`; a browser
wallet can't provide one). **Downloads are signer-less** — recipient (`/r`) and public (`/p`) pages
fetch blobs directly from Shelby with no backend, preserving "decryptable while our backend is offline."
A gated round-trip test lives in `lib/__tests__/` (run with `RUN_SHELBY=1` once the account is funded).

### Blob expiration & renewal (important on Shelbynet)

Shelbynet caps each blob's lifetime at **48 hours**, extendable by up to 48h per call to
`blob_metadata::increase_expiration_time`. A dead man's switch can lock a file for months, so blobs
must be **renewed**. `chooseExpiration` therefore caps the initial expiration at the network limit
(`NEXT_PUBLIC_SHELBY_MAX_BLOB_HOURS`, default 48) in real mode, and `GET /api/cron/renew` (daily, the
second `vercel.json` cron, well under 48h) extends every still-needed blob back to the cap — until the
drop releases and its 7-day retrieval window closes. The uploader account pays the renewal storage fee.

> **Durability caveat:** on a 48h-cap network, if the renewal job stops for >48h every blob expires and
> the affected drops become **permanently undecryptable** — including released-but-unretrieved ones.
> This is inherent to Shelbynet's dev limit and weakens the "operator can vanish" guarantee. Treat
> Shelbynet as the **dev/demo tier**; production durability needs a longer-retention tier (testnet /
> mainnet early access — a dead man's switch is exactly the "needs longer retention" integration
> Shelby invites builders to apply for).

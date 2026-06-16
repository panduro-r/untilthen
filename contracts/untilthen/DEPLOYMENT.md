# Until Then Move contract — deployments

## Shelbynet (current deployment — module renamed `until_then`)

| | |
|---|---|
| Network | **Shelbynet** (`https://api.shelbynet.shelby.xyz/v1`) |
| Module address (`until_then` named addr) | `0x5b736a89f09af953c4d6e6bab08b3245c2f53cc400045221ee8edaeb1ac76e19` |
| Module | `until_then` (was `dead_drop`) |
| Publish txn | `0x76194dd9a358a2782269c0e414db08c038b557fd6331f994af68b23e4348f7d0` |
| `init` (Registry) txn | `0xf409a7198395441200197fc08194d4e8d5d5aeaf212668ba36c3f85dcb85ee58` |
| Status | ✅ published + Registry initialized + verified on-chain |

Deployed via the TS SDK, NOT the aptos CLI: the Shelbynet gateway requires an `Origin` header on
requests, which the CLI can't send (the SDK can, via `clientConfig.HEADERS`). See
`scripts/deploy-untilthen-shelbynet.mjs` — it generates a disposable deployer, funds it from the
Shelby faucet (caps ~0.1 APT/tx), compiles with the CLI (offline), then publishes + inits with the
SDK. Deployer key saved to `.aptos/shelbynet-deployer.txt` (gitignored). Gas note: `maxGasAmount *
gasUnitPrice` is reserved upfront, so keep it within the funded balance (~0.7M units fit ~0.8 APT).

Set in `.env.local` (and on Vercel, then redeploy — `NEXT_PUBLIC_*` bake in at build time):
```
NEXT_PUBLIC_APTOS_NETWORK=shelbynet
NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS=0x5b736a89f09af953c4d6e6bab08b3245c2f53cc400045221ee8edaeb1ac76e19
```

## Shelbynet (previous — superseded by the `until_then` rename)

| | |
|---|---|
| Module address | `0xd758b474abfd383c1bae7a41c5a081052bac4ffe514e37dfd485205e433f6cb0` |
| Module | `dead_drop` |
| Publish txn | `0xc2c85ecaba280b5a1175a96caa762c5d35349654f99b1903d065a26e80185aa5` |
| Status | superseded (module name `dead_drop` showed in wallet prompts) |

## Devnet (previous deployment)

| | |
|---|---|
| Network | Aptos **devnet** |
| Module address (`until_then`) | `0x6b9735ae28dc3eb5d901ba89a64239c374f9334d0523c34a497f46ebe77e5fc4` |
| Module | `dead_drop` |
| Publish txn | `0x0e1bafd67c528c599de4fa806255c2b6da9d1c3e69ee254cd7c324db34aaae84` |
| `init` (Registry) txn | `0xe5fdcba164894ce633388d114e233b656c8e76cd7776cd13e61063539cb7a10b` |
| Status | ✅ published + Registry initialized + verified on-chain |

Set in `.env.local`:
```
NEXT_PUBLIC_APTOS_NETWORK=devnet
NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS=0x6b9735ae28dc3eb5d901ba89a64239c374f9334d0523c34a497f46ebe77e5fc4
```

> **Note:** devnet resets roughly weekly, which wipes this deployment and the funded
> deployer account. Re-deploy with the steps below when that happens. The deployer
> key lives in `.aptos/config.yaml` (gitignored) — devnet-only and disposable.

## Deploy steps (reproducible)

```bash
# 1. Create + fund a deployer account (devnet faucet is programmatic; testnet's now requires a web visit)
printf '\n' | aptos init --profile dd-devnet --network devnet --assume-yes

# 2. Publish (until_then named-address = the deployer account)
cd contracts/untilthen
aptos move publish --profile dd-devnet \
  --named-addresses until_then=<DEPLOYER_ADDR> --assume-yes

# 3. Initialize the on-chain Registry (must be called by the until_then account)
aptos move run --profile dd-devnet \
  --function-id '<DEPLOYER_ADDR>::dead_drop::init' --assume-yes

# 4. Put <DEPLOYER_ADDR> in NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS and set the network.
```

## Testnet / mainnet

Same steps, but fund the deployer at https://aptos.dev/network/faucet (testnet, web visit
required) or with real APT (mainnet). Then set `NEXT_PUBLIC_APTOS_NETWORK` accordingly.

## What's deployed vs. what still needs client wiring

The contract is live and its `verify_share` BLS pairing check passed `aptos move test` 4/4.
To make **multisig usable in the app**, the remaining work is client-side (not on-chain):
a real `MoveContractClient` in `lib/contract.ts` that submits `create_drop` / `approve_release`
via the wallet and reads `get_*` views, the owner-dealt signer-group key + share delivery, the
signer register/approve UI, and un-gating multisig in `lib/armDrop.ts`.

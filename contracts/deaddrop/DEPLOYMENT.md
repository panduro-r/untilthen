# DeadDrop Move contract — deployments

## Shelbynet (current deployment)

| | |
|---|---|
| Network | **Shelbynet** (`https://api.shelbynet.shelby.xyz/v1`) |
| Module address (`deaddrop`) | `0xd758b474abfd383c1bae7a41c5a081052bac4ffe514e37dfd485205e433f6cb0` |
| Module | `dead_drop` |
| Publish txn | `0xc2c85ecaba280b5a1175a96caa762c5d35349654f99b1903d065a26e80185aa5` |
| `init` (Registry) txn | `0x27876d29811354e8aa3e7be913361562606d91cbd010cb5c7eafce5b3fdac1a4` |
| Status | ✅ published + Registry initialized |

Deployed with the wallet-paid switch to Shelbynet (the app and storage now share one network). CLI
profile: `aptos init --profile dd-shelbynet --network custom --rest-url https://api.shelbynet.shelby.xyz/v1`,
then `aptos move publish --named-addresses deaddrop=<addr>` and `aptos move run --function-id <addr>::dead_drop::init`.

Set in `.env.local`:
```
NEXT_PUBLIC_APTOS_NETWORK=shelbynet
NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS=0xd758b474abfd383c1bae7a41c5a081052bac4ffe514e37dfd485205e433f6cb0
```

## Devnet (previous deployment)

| | |
|---|---|
| Network | Aptos **devnet** |
| Module address (`deaddrop`) | `0x6b9735ae28dc3eb5d901ba89a64239c374f9334d0523c34a497f46ebe77e5fc4` |
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

# 2. Publish (deaddrop named-address = the deployer account)
cd contracts/deaddrop
aptos move publish --profile dd-devnet \
  --named-addresses deaddrop=<DEPLOYER_ADDR> --assume-yes

# 3. Initialize the on-chain Registry (must be called by the deaddrop account)
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

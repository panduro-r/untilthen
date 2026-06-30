// lib/shelby.real.ts — real @shelby-protocol/sdk calls behind the lib/shelby.ts surface.
//
// MODEL (verified end-to-end on Shelbynet): the data owner pays for and signs their own storage —
// no server account, no subsidy. An upload is three steps, all client-side:
//   1. generateCommitments(blobData) → merkle root            (in-browser, erasure coding)
//   2. register_blob Aptos tx, signed+paid by the OWNER WALLET (signAndSubmitTransaction)
//   3. putBlob(account=walletAddress, blobData)               → address-only, no private key
// The blob is namespaced by the owner's wallet address, so DOWNLOAD is signer-less and takes that
// address. Recipient/public retrieval therefore needs no backend.
//
// Why this works without a raw Account: registerBlob is just a built Move payload (the wallet submits
// it), and putBlob authorizes off the on-chain registration — it sends only the address, never a key.
//
// Imports the SDK BROWSER subpath; loaded dynamically by lib/shelby.ts only in real mode.

import {
  ShelbyClient,
  ShelbyBlobClient,
  BlobNameSchema,
  generateCommitments,
  ClayErasureCodingProvider,
  defaultErasureCodingConfig,
  expectedTotalChunksets,
  type BlobName,
  type ShelbyNetwork,
  type ErasureCodingProvider,
} from "@shelby-protocol/sdk/browser"
import { Network, AccountAddress } from "@aptos-labs/ts-sdk"

/** A Move entry-function payload, as the wallet adapter's signAndSubmitTransaction expects under `data`. */
type EntryPayload = { function: string; functionArguments: unknown[] }
/** The connected wallet's submit callback (from the wallet adapter). */
export type WalletSubmit = (txn: { data: EntryPayload }) => Promise<{ hash: string }>

function networkFromEnv(): ShelbyNetwork {
  const n = (process.env.NEXT_PUBLIC_SHELBY_NETWORK ?? "shelbynet").toLowerCase()
  if (n === "testnet") return Network.TESTNET
  if (n === "local") return Network.LOCAL
  return Network.SHELBYNET
}

// One client per network — the app follows the wallet's network, so uploads/downloads can target
// shelbynet or testnet within a single session (e.g. a recipient on a different net than the owner).
const clients = new Map<ShelbyNetwork, ShelbyClient>()
function getShelbyClient(network: ShelbyNetwork = networkFromEnv()): ShelbyClient {
  let c = clients.get(network)
  if (!c) {
    // Shelby RPC rate-limits anonymous traffic; an API key (from the Shelby portal) raises the limit.
    // It isn't a secret — it's the same key the browser uses. The key is Shelbynet-only, though: on
    // testnet the SDK's Aptos client hits the standard fullnode, which 401s the key — so omit it there.
    const apiKey = network === Network.SHELBYNET ? process.env.NEXT_PUBLIC_SHELBY_API_KEY : undefined
    c = new ShelbyClient(
      apiKey
        ? { network, apiKey, aptos: { network, clientConfig: { API_KEY: apiKey } } }
        : { network },
    )
    clients.set(network, c)
  }
  return c
}

let provider: ErasureCodingProvider | null = null
async function getProvider(): Promise<ErasureCodingProvider> {
  if (!provider) provider = await ClayErasureCodingProvider.create(defaultErasureCodingConfig())
  return provider
}

function blobName(name: string): BlobName {
  return BlobNameSchema.parse(name)
}

/**
 * Upload ciphertext owned + paid by the connected wallet. Browser-only (drives the wallet adapter).
 * Idempotent: if the blob is already registered for this owner, it re-puts the bytes only.
 */
export async function uploadViaWallet(args: {
  signAndSubmit: WalletSubmit
  ownerAddress: string
  ciphertext: Uint8Array
  blobName: string
  expirationMicros: number
  network?: ShelbyNetwork
}): Promise<{ blobName: string }> {
  const c = getShelbyClient(args.network)
  const name = blobName(args.blobName)
  const account = AccountAddress.from(args.ownerAddress)

  const existing = await c.coordination
    .getBlobMetadata({ account, name })
    .catch(() => null)

  if (!existing) {
    const config = defaultErasureCodingConfig()
    const commitments = await generateCommitments(await getProvider(), args.ciphertext)
    const chunksetSize = config.chunkSizeBytes * config.erasure_k
    const numChunksets = expectedTotalChunksets(args.ciphertext.length, chunksetSize)

    // The OWNER WALLET signs + pays this register_blob transaction on Shelbynet.
    // (deployer defaults to SHELBY_DEPLOYER internally.)
    const payload = ShelbyBlobClient.createRegisterBlobPayload({
      account,
      blobName: name,
      blobSize: args.ciphertext.length,
      blobMerkleRoot: commitments.blob_merkle_root,
      numChunksets,
      expirationMicros: args.expirationMicros,
      encoding: config.enumIndex,
    }) as EntryPayload

    const { hash } = await args.signAndSubmit({ data: payload })
    await c.aptos.waitForTransaction({ transactionHash: hash })
  }

  await c.rpc.putBlob({ account, blobName: name, blobData: args.ciphertext })
  return { blobName: args.blobName }
}

/** Is the blob's on-chain metadata still present? (False after a Shelbynet reset / expiry — a "ghost"
 *  blob whose delete_blob tx would fail. Lets callers skip a doomed wallet popup.) */
export async function isBlobAlive(name: string, ownerAddress: string, network?: ShelbyNetwork): Promise<boolean> {
  try {
    const md = await getShelbyClient(network).coordination.getBlobMetadata({
      account: AccountAddress.from(ownerAddress),
      name: blobName(name),
    })
    return !!md
  } catch {
    return false
  }
}

/** Permanently delete a blob. The OWNER WALLET signs delete_blob; the contract checks ownership, so
 *  no one else can delete someone's file. Browser-only. */
export async function deleteViaWallet(args: {
  signAndSubmit: WalletSubmit
  blobName: string
  network?: ShelbyNetwork
}): Promise<void> {
  const payload = ShelbyBlobClient.createDeleteBlobPayload({ blobName: blobName(args.blobName) }) as EntryPayload
  const { hash } = await args.signAndSubmit({ data: payload })
  await getShelbyClient(args.network).aptos.waitForTransaction({ transactionHash: hash })
}

/** Download ciphertext by blob name from the owner's wallet namespace. Signer-less. */
export async function downloadCiphertext(name: string, ownerAddress: string, network?: ShelbyNetwork): Promise<Uint8Array> {
  const blob = await getShelbyClient(network).download({
    account: AccountAddress.from(ownerAddress),
    blobName: name,
  })
  return drain(blob.readable, blob.contentLength)
}

async function drain(stream: ReadableStream, expectedBytes: number): Promise<Uint8Array> {
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  if (expectedBytes && total !== expectedBytes) {
    throw new Error(`Shelby download length mismatch: got ${total}, expected ${expectedBytes}`)
  }
  return out
}

// lib/deleteDrop.ts — permanently delete a drop: remove the encrypted file from Shelby (the owner's
// wallet signs delete_blob) and the metadata record from our DB (session-authorized), then drop it
// from the local cache. Runs in the browser.

import { getWalletSigner } from "@/lib/aptos"
import { deleteBlob, isBlobAlive } from "@/lib/shelby"
import { useWalletStore } from "@/store/wallet"
import { useDropsStore } from "@/store/drops"

export async function deleteDrop(dropId: string, blobName: string): Promise<void> {
  const wallet = useWalletStore.getState()
  if (!wallet.address) throw new Error("Connect your wallet first.")

  // 1. Delete the file from Shelby. Skip the (doomed) tx if the blob is already gone — e.g. expired
  //    or wiped by a Shelbynet reset. Otherwise the owner wallet signs delete_blob.
  if (await isBlobAlive(blobName, wallet.address)) {
    await deleteBlob({ signer: getWalletSigner(), blobName })
  }

  // 2. Delete the metadata record (authorized by the SIWA session cookie).
  const res = await fetch(`/api/drops/${dropId}/delete`, { method: "POST" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "We couldn't delete this drop. Please try again.")
  }

  // 3. Remove it from the local cache.
  const store = useDropsStore.getState()
  store.setDrops(store.drops.filter((d) => d.id !== dropId))
}

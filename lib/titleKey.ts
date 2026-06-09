// lib/titleKey.ts — the drop-independent owner title key (client-only).
//
// Titles are encrypted at rest; the owner decrypts them with one key derived from a single fixed
// signature, cached in memory for the session so the dashboard decrypts MANY titles with ONE popup.

import { deriveOwnerTitleKey } from "@/lib/crypto"
import { signMessage } from "@/lib/aptos"
import { useWalletStore } from "@/store/wallet"

export const TITLE_KEY_MESSAGE =
  "Until Then — unlock the names of your safes so only you can read them (no transaction, no fee) [v1]"

/** Get the cached owner title key, deriving it (one wallet signature) on first use this session. */
export async function getTitleKey(): Promise<CryptoKey> {
  const cached = useWalletStore.getState().titleKey
  if (cached) return cached
  const sig = await signMessage(TITLE_KEY_MESSAGE)
  const key = await deriveOwnerTitleKey(sig)
  useWalletStore.getState().setTitleKey(key)
  return key
}

import { create } from "zustand"
import type { AppNetwork } from "@/lib/networks"

// Connected-wallet state + live bridges to the adapter. NOT persisted: the wallet adapter
// (autoConnect) is the source of truth and rehydrates on reload; WalletStateProvider repopulates
// this store from useWallet(). The live callbacks let non-React code (lib/aptos.ts) sign/submit
// without importing React. titleKey is the cached drop-independent owner title key (in-memory only).

export type WalletSignResult = { signatureHex: string; fullMessage: string }

type WalletState = {
  address: string | null
  publicKey: string | null // lowercase hex, no 0x
  walletName: string | null
  chain: "aptos"
  titleKey: CryptoKey | null

  // The wallet's active network, mapped to an AppNetwork (null = unsupported/unknown, e.g. a network
  // we don't recognize). rawNetworkName keeps the wallet's label so the UI can say which network it
  // is even when unmapped (e.g. "Mainnet — coming soon"). Driven by the wallet, not an app selector.
  network: AppNetwork | null
  rawNetworkName: string | null

  // Live adapter bridges (in-memory; set by WalletStateProvider). Null when disconnected.
  signMessageFn: ((message: string) => Promise<WalletSignResult>) | null
  signAndSubmitFn: ((txn: unknown) => Promise<{ hash: string }>) | null
  disconnectFn: (() => void) | null

  setConnected: (c: {
    address: string
    publicKey: string | null
    walletName: string
    signMessageFn: (message: string) => Promise<WalletSignResult>
    signAndSubmitFn: (txn: unknown) => Promise<{ hash: string }>
    disconnectFn: () => void
  }) => void
  setNetwork: (network: AppNetwork | null, rawNetworkName: string | null) => void
  clear: () => void
  setTitleKey: (k: CryptoKey | null) => void
}

export const useWalletStore = create<WalletState>((set) => ({
  address: null,
  publicKey: null,
  walletName: null,
  chain: "aptos",
  titleKey: null,
  network: null,
  rawNetworkName: null,
  signMessageFn: null,
  signAndSubmitFn: null,
  disconnectFn: null,

  setConnected: (c) =>
    set({
      address: c.address,
      publicKey: c.publicKey,
      walletName: c.walletName,
      signMessageFn: c.signMessageFn,
      signAndSubmitFn: c.signAndSubmitFn,
      disconnectFn: c.disconnectFn,
    }),
  setNetwork: (network, rawNetworkName) => set({ network, rawNetworkName }),
  // Keep titleKey across a disconnect? No — it's owner-bound; clear it too.
  clear: () =>
    set({
      address: null,
      publicKey: null,
      walletName: null,
      titleKey: null,
      network: null,
      rawNetworkName: null,
      signMessageFn: null,
      signAndSubmitFn: null,
      disconnectFn: null,
    }),
  setTitleKey: (k) => set({ titleKey: k }),
}))

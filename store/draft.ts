import { create } from "zustand"
import type { DropMode, DropDistribution, WalletChain } from "@/types"

// Create-flow draft. IN-MEMORY ONLY (no persist) — it holds transient crypto material (the raw key
// bytes, ciphertext) that must NEVER touch localStorage. A mid-flow reload restarts the flow.

export type RecipientDraft = {
  id: string
  type: "email" | "wallet"
  name?: string
  email: string
  backupEmail?: string
  walletAddress?: string
  walletChain?: WalletChain
  // wallet recipients: populated once they pre-register
  registered?: boolean
  registrationSignature?: string
}

export type SignerDraft = {
  id: string
  name?: string
  address: string
  chain: WalletChain
  email: string
  blsPubkey?: string
  registered?: boolean
}

export type Draft = {
  dropId: string | null
  fileMeta: { name: string; size: number; type: string } | null

  // Transient crypto outputs from the encrypt step (in-memory only).
  ciphertext: Uint8Array | null
  iv: Uint8Array | null
  keyBytes: Uint8Array | null
  fingerprint: string | null

  distribution: DropDistribution
  mode: DropMode

  // timelock
  checkInHours: number
  graceDays: number
  // multisig
  signers: SignerDraft[]
  threshold: number

  // confirm
  title: string
  recipients: RecipientDraft[]
  publicAck: boolean
}

type DraftStore = Draft & {
  set: (patch: Partial<Draft>) => void
  reset: () => void
}

const initial: Draft = {
  dropId: null,
  fileMeta: null,
  ciphertext: null,
  iv: null,
  keyBytes: null,
  fingerprint: null,
  distribution: "private",
  mode: "timelock",
  checkInHours: 30 * 24,
  graceDays: 7,
  signers: [],
  threshold: 2,
  title: "",
  recipients: [],
  publicAck: false,
}

export const useDraftStore = create<DraftStore>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set({ ...initial }),
}))

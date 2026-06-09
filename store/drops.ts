import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { DropMode, DropDistribution, DropStatus } from "@/types"

// Client-side CACHE of the user's own drops for fast dashboard rendering. The source of truth is
// Supabase + the chain. This holds metadata only — NEVER crypto material (no shardA, tlockShardA,
// secrets). Persisted to localStorage so the dashboard paints instantly on reload.

export type DropSummary = {
  id: string
  title: string // decrypted client-side; "" when fetched from the server and not yet revealed
  encryptedTitle?: string // present on server-fetched drops; decrypt on demand with the title key
  mode: DropMode
  distribution: DropDistribution
  status: DropStatus
  triggerAt: number | null
  recipientCount: number
  created: number
}

type DropsState = {
  drops: DropSummary[]
  setDrops: (drops: DropSummary[]) => void
  upsertDrop: (drop: DropSummary) => void
  getDrop: (id: string) => DropSummary | undefined
  clear: () => void
}

export const useDropsStore = create<DropsState>()(
  persist(
    (set, get) => ({
      drops: [],
      setDrops: (drops) => set({ drops }),
      upsertDrop: (drop) =>
        set((s) => {
          const i = s.drops.findIndex((d) => d.id === drop.id)
          if (i === -1) return { drops: [drop, ...s.drops] }
          const next = s.drops.slice()
          next[i] = drop
          return { drops: next }
        }),
      getDrop: (id) => get().drops.find((d) => d.id === id),
      clear: () => set({ drops: [] }),
    }),
    { name: "deaddrop:drops" },
  ),
)

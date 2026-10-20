// lib/useClientValue.ts — read browser-only state (localStorage) without an SSR/hydration mismatch.

import { useSyncExternalStore } from "react"

// Never notifies: values are re-read whenever the component re-renders. Cross-tab `storage` events are
// ignored on purpose — another tab connecting a wallet doesn't make THIS tab's adapter reconnect.
const subscribe = () => () => {}

// `serverValue` during SSR and the hydration render, `read()` on every client render after. `read` may
// throw (localStorage can be unavailable), which also yields `serverValue`. Primitives only, so a
// snapshot is stable across reads.
export function useClientValue<T extends string | boolean | null>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return read()
      } catch {
        return serverValue
      }
    },
    () => serverValue,
  )
}

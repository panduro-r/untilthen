"use client"

// Root client providers (CLAUDE.md Step 14 nesting, minus the Shelby provider — we use the
// IndexedDB/in-memory mock until the access-gated Shelby SDK is available):
//   QueryClientProvider → AptosWalletAdapterProvider → WalletStateProvider
import { useState, type ReactNode } from "react"
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react"
import { Network } from "@aptos-labs/ts-sdk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import WalletStateProvider from "@/components/wallet/WalletStateProvider"

function appNetwork(): Network {
  switch (process.env.NEXT_PUBLIC_APTOS_NETWORK) {
    case "mainnet":
      return Network.MAINNET
    case "testnet":
      return Network.TESTNET
    case "devnet":
      return Network.DEVNET
    default:
      return Network.SHELBYNET // default hint only — see below
  }
}
// dappConfig.network is just the adapter's DEFAULT/expected-network hint. The app's real active
// network follows the connected wallet (WalletStateProvider reads useWallet().network into the store),
// and AIP-62 wallets submit on their own active network — so this default doesn't pin the app.
const network = appNetwork()

// The adapter resolves the connected account's ANS (.apt) name on EVERY connect, using its own Aptos
// client built from dappConfig. On Testnet/Mainnet that hits the public fullnode — rate-limited without
// a key (~several seconds) — which stalls the "Reconnecting your wallet…" spinner on every refresh.
// Pass the Aptos Build keys here so that lookup is fast. (Shelbynet skips ANS — it's not an Aptos-name
// network — which is why Shelbynet reconnect was already fast and Testnet wasn't.)
const aptosApiKeys: Partial<Record<Network, string>> = {}
if (process.env.NEXT_PUBLIC_APTOS_API_KEY_TESTNET) aptosApiKeys[Network.TESTNET] = process.env.NEXT_PUBLIC_APTOS_API_KEY_TESTNET
if (process.env.NEXT_PUBLIC_APTOS_API_KEY_MAINNET) aptosApiKeys[Network.MAINNET] = process.env.NEXT_PUBLIC_APTOS_API_KEY_MAINNET

// Surface only Petra. Without this the AIP-62 adapter offers every announced wallet (Backpack, OKX,
// Nightly, keyless Google/Apple…) — but Shelbynet has no Aptos Keyless module and several of those
// wallets have no usable Shelbynet network, so users would connect and then hit an opaque failure on
// the first transaction. Fail closed to Petra. (Pattern borrowed from the frameloop Shelby app.)
const OPT_IN_WALLETS = ["Petra"] as const

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <AptosWalletAdapterProvider
        autoConnect
        optInWallets={OPT_IN_WALLETS}
        dappConfig={{ network, aptosApiKeys }}
      >
        <WalletStateProvider>{children}</WalletStateProvider>
      </AptosWalletAdapterProvider>
    </QueryClientProvider>
  )
}

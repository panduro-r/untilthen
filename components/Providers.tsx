"use client"

// Root client providers (CLAUDE.md Step 14 nesting, minus the Shelby provider — we use the
// IndexedDB/in-memory mock until the access-gated Shelby SDK is available):
//   QueryClientProvider → AptosWalletAdapterProvider → WalletStateProvider
import { useState, type ReactNode } from "react"
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react"
import { Network } from "@aptos-labs/ts-sdk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import WalletStateProvider from "@/components/wallet/WalletStateProvider"

const network = process.env.NEXT_PUBLIC_APTOS_NETWORK === "mainnet" ? Network.MAINNET : Network.TESTNET

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <AptosWalletAdapterProvider autoConnect dappConfig={{ network }}>
        <WalletStateProvider>{children}</WalletStateProvider>
      </AptosWalletAdapterProvider>
    </QueryClientProvider>
  )
}

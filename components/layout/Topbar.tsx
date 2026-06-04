"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Wallet } from "lucide-react"
import { useWalletStore } from "@/store/wallet"
import { disconnectWallet } from "@/lib/aptos"
import { formatAddress } from "@/lib/ids"
import ConnectModal from "@/components/wallet/ConnectModal"

export default function Topbar() {
  const [connectOpen, setConnectOpen] = useState(false)
  const address = useWalletStore((s) => s.address)
  const pathname = usePathname()
  const authed = !!address

  const navCls = (active: boolean) => (active ? "active" : "")

  return (
    <header className="topbar">
      <Link href={authed ? "/dashboard" : "/"} className="brand" style={{ textDecoration: "none" }}>
        <div className="brand-mark" />
        <div className="brand-name">DeadDrop</div>
      </Link>

      <div className="topbar-spacer" />

      <nav className="topbar-nav">
        {authed ? (
          <>
            <Link href="/dashboard" className={navCls(pathname === "/dashboard")}>Dashboard</Link>
            <Link href="/new/encrypt" className={navCls(pathname.startsWith("/new"))}>New drop</Link>
            <Link href="/security" className={navCls(pathname === "/security")}>Security</Link>
          </>
        ) : (
          <>
            <Link href="/" className={navCls(pathname === "/")}>Overview</Link>
            <Link href="/security" className={navCls(pathname === "/security")}>Security</Link>
          </>
        )}
      </nav>

      {authed ? (
        <button
          className="account-pill"
          onClick={() => disconnectWallet()}
          title="Click to disconnect"
        >
          <span className="avatar" />
          <span className="mono" style={{ fontSize: 12 }}>{formatAddress(address)}</span>
        </button>
      ) : (
        <button className="btn btn-ghost btn-sm" onClick={() => setConnectOpen(true)}>
          <Wallet size={14} /> Connect wallet
        </button>
      )}

      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </header>
  )
}

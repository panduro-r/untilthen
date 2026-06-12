import type { Metadata } from "next"
import { Hanken_Grotesk, Fraunces, Spline_Sans_Mono } from "next/font/google"
import "./globals.css"
import Providers from "@/components/Providers"
import Topbar from "@/components/layout/Topbar"
import Footer from "@/components/layout/Footer"
import FundingModal from "@/components/wallet/FundingModal"

// Type system (referenced by globals.css design tokens): a warm humanist grotesque for UI, the
// characterful Fraunces serif for editorial headings, and Spline Sans Mono for addresses/status.
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans-src" })
const serif = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-serif-src" })
const mono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-mono-src" })

export const metadata: Metadata = {
  title: "Until Then — a dead man's switch for sensitive files",
  description:
    "Encrypt files in your browser, store the ciphertext on Shelby, and release the key on a time-lock or multi-sig condition. No server ever sees plaintext.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <Providers>
          <div className="app-shell">
            <Topbar />
            <main>{children}</main>
            <Footer />
          </div>
          <FundingModal />
        </Providers>
      </body>
    </html>
  )
}

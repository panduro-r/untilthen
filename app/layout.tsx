import type { Metadata } from "next"
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google"
import "./globals.css"
import Providers from "@/components/Providers"
import Topbar from "@/components/layout/Topbar"
import Footer from "@/components/layout/Footer"

// Families referenced by the design tokens in globals.css (--font-geist-sans etc.).
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
})

export const metadata: Metadata = {
  title: "DeadDrop — a dead man's switch for sensitive files",
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
        </Providers>
      </body>
    </html>
  )
}

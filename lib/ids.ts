// lib/ids.ts — ID generation and display formatters.
// IDs are prefixed + 8 random hex chars and are allocated client-side (the dropId must exist before
// recipient/signer pre-registration, see ARCHITECTURE.md "Wallet recipient pre-registration").

function randomHex(nChars: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(nChars / 2)))
  let hex = ""
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex.slice(0, nChars)
}

// New safes get a "safe_" id; existing "drop_" ids keep working (the id is an opaque text key — no
// format check anywhere — and the blob name is derived from whatever the id is).
export function dropId(): string {
  return `safe_${randomHex(8)}`
}

export function recipientId(): string {
  return `rcpt_${randomHex(8)}`
}

export function signerId(): string {
  return `sgnr_${randomHex(8)}`
}

/** Shorten an address for display: 0x7f3a2c81…c5d6e7f8 */
export function formatAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

/** Base64url-encode bytes for URL fragments (email-recipient secret). RFC 4648 §5, no padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

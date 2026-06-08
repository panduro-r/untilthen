// POST /api/shelby/upload — server-side Shelby upload (real mode only).
//
// The owner's browser encrypts the file, then POSTs the resulting CIPHERTEXT here as base64. This
// route signs+pays the Shelby upload with the server uploader Account (lib/shelby.server.ts), because
// Shelby's SDK needs a raw Account and a browser wallet can't provide one. Plaintext never reaches
// this route — only ciphertext — so the no-plaintext-outside-the-browser invariant holds.
//
// Node runtime: the Shelby SDK + Aptos SDK + key handling need Node APIs.

import { z } from "zod"
import { unb64 } from "@/lib/crypto"
import { uploadCiphertext } from "@/lib/shelby.server"

export const runtime = "nodejs"

const bodySchema = z.object({
  ciphertext: z.string().min(1), // base64
  blobName: z.string().min(1),
  expirationMicros: z.number().int().positive(),
})

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await req.json())
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }

  try {
    const ciphertext = unb64(parsed.ciphertext)
    const { blobName } = await uploadCiphertext({
      ciphertext,
      blobName: parsed.blobName,
      expirationMicros: parsed.expirationMicros,
    })
    return Response.json({ blobName })
  } catch (err) {
    console.error("[shelby] upload route failed:", err)
    return Response.json(
      { error: "We couldn't store your file right now. Please try again." },
      { status: 502 },
    )
  }
}

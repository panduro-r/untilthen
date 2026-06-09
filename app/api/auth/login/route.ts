// POST /api/auth/login — Sign In With Aptos. Verifies a wallet-ownership signature and sets a session
// cookie. Proves ownership only; authorizes no transaction and unlocks no secret.

import { siwaSchema, verifySiwa } from "@/lib/auth"
import { setSessionCookie } from "@/lib/session"

export const runtime = "nodejs"

export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }
  const parsed = siwaSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 })

  const address = verifySiwa(parsed.data)
  if (!address) {
    return Response.json({ error: "Signature verification failed." }, { status: 401 })
  }

  await setSessionCookie(address)
  return Response.json({ address })
}

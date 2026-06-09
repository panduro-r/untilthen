// GET /api/auth/session — current signed-in owner address (or null).
import { getSession } from "@/lib/session"

export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  const session = await getSession()
  return Response.json({ address: session?.address ?? null })
}

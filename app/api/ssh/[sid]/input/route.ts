import { getCurrentUser } from "@/lib/auth/session"
import { getSession, writeInput } from "@/lib/ssh/sessions"

export const dynamic = "force-dynamic"

const MAX_INPUT = 64 * 1024

/** Envoie des frappes au terminal. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sid: string }> }
) {
  const user = await getCurrentUser()
  const { sid } = await params
  const session = user ? getSession(sid, user.id) : null
  if (!session)
    return Response.json({ error: "Session introuvable" }, { status: 404 })

  const body = (await request.json().catch(() => null)) as {
    data?: unknown
  } | null
  if (typeof body?.data !== "string" || body.data.length > MAX_INPUT) {
    return Response.json({ error: "Entrée invalide" }, { status: 400 })
  }

  writeInput(session, body.data)
  return new Response(null, { status: 204 })
}

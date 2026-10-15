import { getCurrentUser } from "@/lib/auth/session"
import { closeSession, getSession } from "@/lib/ssh/sessions"

export const dynamic = "force-dynamic"

/** Ferme la session SSH. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sid: string }> }
) {
  const user = await getCurrentUser()
  const { sid } = await params
  const session = user ? getSession(sid, user.id) : null
  if (session) closeSession(session.id)
  return new Response(null, { status: 204 })
}

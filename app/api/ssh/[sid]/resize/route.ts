import { z } from "zod"

import { getCurrentUser } from "@/lib/auth/session"
import { getSession, resize } from "@/lib/ssh/sessions"

export const dynamic = "force-dynamic"

const schema = z.object({
  cols: z.coerce.number().int().min(20).max(400),
  rows: z.coerce.number().int().min(5).max(200),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sid: string }> }
) {
  const user = await getCurrentUser()
  const { sid } = await params
  const session = user ? getSession(sid, user.id) : null
  if (!session)
    return Response.json({ error: "Session introuvable" }, { status: 404 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Dimensions invalides" }, { status: 400 })
  }

  resize(session, parsed.data.cols, parsed.data.rows)
  return new Response(null, { status: 204 })
}

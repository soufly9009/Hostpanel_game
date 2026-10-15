import { eq } from "drizzle-orm"

import { getCurrentUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { liveStatus } from "@/lib/provision"
import { ProxmoxError } from "@/lib/proxmox/client"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: "Non connecté" }, { status: 401 })

  const { id } = await params
  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, id))
  if (!server || (server.userId !== user.id && user.role !== "admin")) {
    return Response.json({ error: "Introuvable" }, { status: 404 })
  }

  try {
    const live = await liveStatus(server)
    return Response.json({
      ...live,
      suspended: live.suspended || server.suspended,
    })
  } catch (e) {
    const message =
      e instanceof ProxmoxError || e instanceof Error ? e.message : "Erreur"
    return Response.json({ error: message }, { status: 502 })
  }
}

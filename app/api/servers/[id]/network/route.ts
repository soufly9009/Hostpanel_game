import { eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { networkOptionsForPlan } from "@/lib/ipam/options"
import { getAccessibleServerOrNull } from "@/lib/servers/access"

export const dynamic = "force-dynamic"

/** Options réseau pour modifier la configuration d'un VPS (propriétaire/admin). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const server = await getAccessibleServerOrNull(id)
  if (!server) return Response.json({ error: "Introuvable" }, { status: 404 })
  if (!server.planId) {
    return Response.json({ planModes: "dhcp", networks: [] })
  }

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, server.planId))
  if (!plan) return Response.json({ planModes: "dhcp", networks: [] })

  return Response.json(await networkOptionsForPlan(plan))
}

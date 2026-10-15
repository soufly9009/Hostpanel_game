import { and, eq } from "drizzle-orm"

import { getCurrentUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { networkOptionsForPlan } from "@/lib/ipam/options"

export const dynamic = "force-dynamic"

/** Réseaux et adresses proposables pour une offre (utilisateur connecté). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: "Introuvable" }, { status: 404 })

  const { id } = await params
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.id, id), eq(schema.plans.isActive, true)))
  if (!plan) return Response.json({ error: "Introuvable" }, { status: 404 })

  return Response.json(await networkOptionsForPlan(plan))
}

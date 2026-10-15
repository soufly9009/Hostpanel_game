import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { authenticateApi, readJson } from "@/lib/api/auth"
import { badRequest, notFound, toApiUser } from "@/lib/api/respond"
import { db, schema } from "@/lib/db"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "users:read")
  if (auth instanceof Response) return auth
  const { id } = await params

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
  if (!user) return notFound("Compte")

  const [servers, sites] = await Promise.all([
    db
      .select({
        id: schema.servers.id,
        name: schema.servers.name,
        suspended: schema.servers.suspended,
        expiresAt: schema.servers.expiresAt,
      })
      .from(schema.servers)
      .where(eq(schema.servers.userId, id)),
    db
      .select({ id: schema.sites.id, domain: schema.sites.domain })
      .from(schema.sites)
      .where(eq(schema.sites.userId, id)),
  ])
  return Response.json({
    ok: true,
    user: toApiUser(user),
    servers: servers.map((s) => ({
      ...s,
      expiresAt: s.expiresAt?.toISOString() ?? null,
    })),
    sites,
  })
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    serverLimit: z.number().int().min(0).max(1000).optional(),
  })
  .strict()

/** Modifie le nom ou la limite de VPS (jamais le rôle ni l'e-mail). */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "users:write")
  if (auth instanceof Response) return auth
  const { id } = await params

  const body = await readJson(request)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues[0]?.message ?? "Champs autorisés : name, serverLimit"
    )
  }
  if (Object.keys(parsed.data).length === 0)
    return badRequest("Rien à modifier")

  const [user] = await db
    .update(schema.users)
    .set(parsed.data)
    .where(eq(schema.users.id, id))
    .returning()
  if (!user) return notFound("Compte")

  await logActivity({ id: "", email: auth.actor }, "Compte modifié via l'API", {
    type: "account",
    id,
    label: Object.keys(parsed.data).join(", "),
  })
  return Response.json({ ok: true, user: toApiUser(user) })
}

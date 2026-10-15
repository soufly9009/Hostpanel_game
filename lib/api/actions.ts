"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireAdmin } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { auditSensitive } from "@/lib/discord/audit"

import { generateApiKey } from "./auth"
import { API_SCOPE_KEYS } from "./scopes"

export type ApiKeyState =
  { error?: string; ok?: boolean; key?: string; name?: string } | undefined

const createSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(60),
  expiresInDays: z.coerce.number().int().min(0).max(3650).default(0),
})

/** Crée une clé : affichée UNE seule fois, seule son empreinte est stockée. */
export async function createApiKeyAction(
  _prev: ApiKeyState,
  formData: FormData
): Promise<ApiKeyState> {
  const admin = await requireAdmin()
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    expiresInDays: formData.get("expiresInDays") || 0,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const scopes = [
    ...new Set(
      formData
        .getAll("scopes")
        .map(String)
        .filter((s) => API_SCOPE_KEYS.includes(s))
    ),
  ]
  if (scopes.length === 0) return { error: "Choisis au moins une portée." }

  const { key, prefix, hash } = generateApiKey()
  const days = parsed.data.expiresInDays
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      name: parsed.data.name,
      prefix,
      keyHash: hash,
      scopes,
      createdBy: admin.email,
      expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
    })
    .returning({ id: schema.apiKeys.id })

  await logActivity(admin, "Clé d'API créée", {
    type: "api",
    id: row.id,
    label: `${parsed.data.name} (${prefix}…)`,
  })
  auditSensitive(
    admin,
    "Clé d'API créée",
    { clé: prefix, portées: scopes.join(",") },
    scopes.some((s) => s.endsWith(":write")) ? "warning" : "info"
  )
  revalidatePath("/admin/api")
  return { ok: true, key, name: parsed.data.name }
}

export async function revokeApiKeyAction(id: string) {
  const admin = await requireAdmin()
  const [row] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(schema.apiKeys.id, z.string().min(1).max(64).parse(id)))
    .returning()
  if (!row) return { error: "Clé introuvable" }
  await logActivity(admin, "Clé d'API révoquée", {
    type: "api",
    id,
    label: `${row.name} (${row.prefix}…)`,
  })
  auditSensitive(admin, "Clé d'API révoquée", { clé: row.prefix }, "warning")
  revalidatePath("/admin/api")
  return { ok: true }
}

export async function deleteApiKeyAction(id: string) {
  const admin = await requireAdmin()
  const [row] = await db
    .delete(schema.apiKeys)
    .where(eq(schema.apiKeys.id, z.string().min(1).max(64).parse(id)))
    .returning()
  if (!row) return { error: "Clé introuvable" }
  await logActivity(admin, "Clé d'API supprimée", {
    type: "api",
    label: `${row.name} (${row.prefix}…)`,
  })
  revalidatePath("/admin/api")
  return { ok: true }
}

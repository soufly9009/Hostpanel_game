"use server"

import { revalidatePath } from "next/cache"
import { and, count, eq, ne } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { allPermissionKeys } from "@/lib/auth/permissions"
import { PERMISSION_KEY_RE } from "@/lib/auth/roles"
import { requireAdmin } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { auditSensitive } from "@/lib/discord/audit"

export type RoleState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)

function refresh() {
  revalidatePath("/admin/roles")
  revalidatePath("/admin/users")
}

/** Ne garde que des clés de permission connues (jamais de valeur libre). */
async function sanitizePermissions(keys: string[]) {
  const known = await allPermissionKeys()
  return [...new Set(keys.filter((k) => known.has(k)))]
}

/* ───────────── Rôles ───────────── */

const roleSchema = z.object({
  name: z.string().trim().min(3, "Nom trop court").max(60),
  description: z.string().trim().max(200).optional(),
})

export async function createRoleAction(
  _prev: RoleState,
  formData: FormData
): Promise<RoleState> {
  const admin = await requireAdmin()
  const parsed = roleSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const key = slug(parsed.data.name)
  if (key.length < 3) return { error: "Nom invalide." }

  const permissions = await sanitizePermissions(
    formData.getAll("permissions").map(String)
  )

  try {
    await db.insert(schema.roles).values({
      key,
      name: parsed.data.name,
      description: parsed.data.description || null,
      permissions,
    })
  } catch {
    return { error: "Un rôle porte déjà ce nom." }
  }

  await logActivity(admin, "Rôle créé", { type: "role", label: key })
  auditSensitive(admin, "Rôle créé", {
    rôle: key,
    permissions: permissions.length,
  })
  refresh()
  return { ok: true, notice: "Rôle créé." }
}

export async function updateRolePermissionsAction(
  roleId: string,
  keys: string[]
): Promise<RoleState> {
  const admin = await requireAdmin()
  const id = z.string().min(1).max(64).parse(roleId)
  const permissions = await sanitizePermissions(keys)

  const res = await db
    .update(schema.roles)
    .set({ permissions })
    .where(eq(schema.roles.id, id))
  if (res.rowsAffected !== 1) return { error: "Rôle introuvable" }

  await logActivity(admin, "Permissions d'un rôle modifiées", {
    type: "role",
    id,
  })
  auditSensitive(admin, "Permissions d'un rôle modifiées", {
    rôle: id.slice(0, 8),
    permissions: permissions.length,
  })
  refresh()
  return { ok: true }
}

export async function deleteRoleAction(roleId: string): Promise<RoleState> {
  const admin = await requireAdmin()
  const id = z.string().min(1).max(64).parse(roleId)

  const [role] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.id, id))
  if (!role) return { error: "Rôle introuvable" }
  if (role.isSystem)
    return { error: "Un rôle système ne peut pas être supprimé." }

  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.users)
    .where(eq(schema.users.roleId, id))
  if (n > 0) {
    return { error: `Rôle encore attribué à ${n} membre(s) du support.` }
  }

  await db.delete(schema.roles).where(eq(schema.roles.id, id))
  await logActivity(admin, "Rôle supprimé", { type: "role", label: role.key })
  auditSensitive(admin, "Rôle supprimé", { rôle: role.key }, "warning")
  refresh()
  return { ok: true }
}

/* ───────────── Permissions ───────────── */

const permSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      PERMISSION_KEY_RE,
      "Format attendu : domaine.action (ex. billing.refund)"
    ),
  label: z.string().trim().min(3, "Libellé trop court").max(80),
  description: z.string().trim().max(200).optional(),
})

export async function createPermissionAction(
  _prev: RoleState,
  formData: FormData
): Promise<RoleState> {
  const admin = await requireAdmin()
  const parsed = permSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  try {
    await db.insert(schema.permissions).values({
      key: parsed.data.key,
      label: parsed.data.label,
      description: parsed.data.description || null,
      isSystem: false,
    })
  } catch {
    return { error: "Cette permission existe déjà." }
  }

  await logActivity(admin, "Permission créée", {
    type: "role",
    label: parsed.data.key,
  })
  auditSensitive(admin, "Permission créée", { permission: parsed.data.key })
  refresh()
  return {
    ok: true,
    notice:
      "Permission créée. Elle n'a d'effet que si le code (ou une intégration) la vérifie.",
  }
}

export async function deletePermissionAction(key: string): Promise<RoleState> {
  const admin = await requireAdmin()
  const k = z.string().min(3).max(60).parse(key)

  const [p] = await db
    .select()
    .from(schema.permissions)
    .where(eq(schema.permissions.key, k))
  if (!p) return { error: "Permission introuvable" }
  if (p.isSystem) {
    return { error: "Une permission système ne peut pas être supprimée." }
  }

  await db.transaction(async (tx) => {
    // Retire la clé des rôles qui la contiennent.
    const roles = await tx.select().from(schema.roles)
    for (const r of roles) {
      if (r.permissions.includes(k)) {
        await tx
          .update(schema.roles)
          .set({ permissions: r.permissions.filter((x) => x !== k) })
          .where(eq(schema.roles.id, r.id))
      }
    }
    await tx.delete(schema.permissions).where(eq(schema.permissions.key, k))
  })

  await logActivity(admin, "Permission supprimée", { type: "role", label: k })
  auditSensitive(admin, "Permission supprimée", { permission: k }, "warning")
  refresh()
  return { ok: true }
}

/* ───────────── Attribution d'un rôle à un utilisateur ───────────── */

const assignSchema = z.object({
  role: z.enum(["user", "support", "admin"]),
  roleId: z.string().max(64).nullable(),
})

export async function setUserRoleAction(
  userId: string,
  input: { role: string; roleId: string | null }
): Promise<RoleState> {
  const admin = await requireAdmin()
  const uid = z.string().min(1).max(64).parse(userId)
  const parsed = assignSchema.safeParse(input)
  if (!parsed.success) return { error: "Rôle invalide" }
  const { role } = parsed.data

  if (uid === admin.id) {
    return { error: "Tu ne peux pas modifier ton propre rôle." }
  }

  const [target] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, uid))
  if (!target) return { error: "Utilisateur introuvable" }

  // Un rôle personnalisé n'a de sens que pour le support, et doit exister.
  let roleId: string | null = null
  if (role === "support" && parsed.data.roleId) {
    const [r] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.id, parsed.data.roleId))
    if (!r) return { error: "Rôle personnalisé introuvable" }
    roleId = r.id
  }

  // Toujours au moins un administrateur.
  if (target.role === "admin" && role !== "admin") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.users)
      .where(and(eq(schema.users.role, "admin"), ne(schema.users.id, uid)))
    if (n === 0) {
      return { error: "Il doit rester au moins un administrateur." }
    }
  }

  await db
    .update(schema.users)
    .set({ role, roleId })
    .where(eq(schema.users.id, uid))
  // Un changement de rôle invalide les sessions du compte (reconnexion).
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid))

  await logActivity(admin, `Rôle modifié : ${role}`, {
    type: "role",
    id: uid,
    label: target.email,
  })
  auditSensitive(
    admin,
    "Rôle d'un utilisateur modifié",
    { utilisateur: uid.slice(0, 8), rôle: role },
    role === "admin" ? "warning" : "info"
  )
  refresh()
  return { ok: true }
}

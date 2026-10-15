import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"

import {
  DEFAULT_SUPPORT,
  SYSTEM_PERMISSIONS,
  homeFor,
  isStaffRole,
  type RoleName,
} from "./roles"
import { getCurrentUser } from "./session"

type Subject = { role: RoleName; roleId?: string | null }

/** Rôles livrés avec le panel (créés au besoin, jamais écrasés). */
const SYSTEM_ROLES = [
  {
    key: "support_l1",
    name: "Support niveau 1",
    description: "Répond aux tickets, sans gestion ni vue des services.",
    permissions: [
      "tickets.view_all",
      "tickets.reply",
      "tickets.internal_note",
      "tickets.ai",
    ],
  },
  {
    key: "support_full",
    name: "Support complet",
    description: "Toutes les permissions de support.",
    permissions: DEFAULT_SUPPORT,
  },
  {
    key: "billing",
    name: "Facturation",
    description: "Soldes de crédits, coupons et cartes cadeaux.",
    permissions: [
      "wallet.view",
      "wallet.adjust",
      "coupons.manage",
      "users.view",
    ],
  },
  {
    key: "legal",
    name: "Juridique",
    description: "Rédaction, publication et suppression des documents légaux.",
    permissions: ["legal.edit", "legal.publish", "legal.delete"],
  },
]

/** Crée le catalogue et les rôles système s'ils n'existent pas (idempotent). */
export async function ensureRbacSeed() {
  for (const p of SYSTEM_PERMISSIONS) {
    await db
      .insert(schema.permissions)
      .values({ ...p, isSystem: true })
      .onConflictDoUpdate({
        target: schema.permissions.key,
        set: { label: p.label, description: p.description, isSystem: true },
      })
  }
  for (const r of SYSTEM_ROLES) {
    await db
      .insert(schema.roles)
      .values({ ...r, isSystem: true })
      .onConflictDoNothing()
  }
}

/** Toutes les clés de permission connues (système + personnalisées). */
export async function allPermissionKeys() {
  const rows = await db
    .select({ key: schema.permissions.key })
    .from(schema.permissions)
  return new Set([
    ...SYSTEM_PERMISSIONS.map((p) => p.key),
    ...rows.map((r) => r.key),
  ])
}

/**
 * Permissions effectives. L'administrateur a tout ; un client n'a aucune
 * permission de personnel ; le support dépend de son rôle personnalisé.
 */
export const permissionsFor = cache(
  async (subject: Subject): Promise<Set<string>> => {
    if (subject.role === "admin") return await allPermissionKeys()
    if (subject.role !== "support") return new Set()

    if (subject.roleId) {
      const [role] = await db
        .select({ permissions: schema.roles.permissions })
        .from(schema.roles)
        .where(eq(schema.roles.id, subject.roleId))
      // Rôle introuvable (supprimé, identifiant corrompu) : aucun droit,
      // plutôt qu'un repli sur des permissions plus larges.
      return role ? new Set(role.permissions) : new Set()
    }
    return new Set(DEFAULT_SUPPORT)
  }
)

export async function can(subject: Subject, key: string) {
  return (await permissionsFor(subject)).has(key)
}

/** Accès à l'espace support : personnel uniquement. */
export async function requireStaff() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!isStaffRole(user.role)) redirect(homeFor(user.role))
  return user
}

/** Exige une permission ; sinon retour à l'accueil du rôle. */
export async function requirePermission(key: string) {
  const user = await requireStaff()
  if (!(await can(user, key))) redirect("/support?denied=1")
  return user
}

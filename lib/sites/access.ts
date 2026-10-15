import "server-only"

import { eq } from "drizzle-orm"

import { getCurrentUser, requireUser } from "@/lib/auth/session"
import type { RoleName } from "@/lib/auth/roles"
import { db, schema } from "@/lib/db"

async function findSiteFor(
  user: { id: string; role: RoleName },
  siteId: string
) {
  const [site] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId))
  if (!site || (site.userId !== user.id && user.role !== "admin")) return null
  return site
}

/** Site accessible à l'utilisateur courant (propriétaire ou admin). */
export async function getAccessibleSite(siteId: string) {
  return findSiteFor(await requireUser(), siteId)
}

/** Variante pour les route handlers : null si non connecté. */
export async function getAccessibleSiteOrNull(siteId: string) {
  const user = await getCurrentUser()
  return user ? findSiteFor(user, siteId) : null
}

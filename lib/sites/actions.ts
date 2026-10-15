"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { count, eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import {
  errorText,
  logError,
  logSuccess,
  logWarning,
} from "@/lib/discord/logging"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"
import {
  createDomain,
  DOMAIN_RE,
  deleteDomain,
  isPleskConnectivityError,
  issueLetsEncrypt,
  PleskError,
  randomFtpLogin,
  randomPassword,
} from "@/lib/plesk/client"
import { getAccessibleSite } from "@/lib/sites/access"

export type ActionState = { error?: string } | undefined

const errorMessage = (e: unknown) =>
  e instanceof PleskError
    ? `Plesk : ${e.message}`
    : e instanceof Error
      ? e.message
      : "Erreur inconnue"

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(DOMAIN_RE, "Nom de domaine invalide (ex. exemple.com)")

export async function createSite(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser()

  const parsed = domainSchema.safeParse(formData.get("domain"))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const domain = parsed.data

  const [{ owned }] = await db
    .select({ owned: count() })
    .from(schema.sites)
    .where(eq(schema.sites.userId, user.id))
  if (user.role !== "admin" && owned >= env.PLESK_SITE_LIMIT) {
    return { error: `Limite atteinte (${env.PLESK_SITE_LIMIT} sites).` }
  }

  const [existing] = await db
    .select({ id: schema.sites.id })
    .from(schema.sites)
    .where(eq(schema.sites.domain, domain))
  if (existing) return { error: "Ce domaine est déjà utilisé." }

  const id = crypto.randomUUID()
  const ftpLogin = randomFtpLogin()
  let pleskId: number
  try {
    ;({ pleskId } = await createDomain({
      domain,
      ftpLogin,
      ftpPassword: randomPassword(),
    }))
  } catch (e) {
    // Les pannes de connexion Plesk sont déjà signalées par le client.
    if (!isPleskConnectivityError(e)) {
      void logError({
        category: "plesk",
        title: "Échec de création d'un site",
        service: "Site web",
        action: "création",
        result: "failure",
        message: errorText(e),
        dedupeKey: `site-create:${user.id}`,
      })
    }
    return { error: errorMessage(e) }
  }

  try {
    await db
      .insert(schema.sites)
      .values({ id, userId: user.id, domain, pleskId, ftpLogin })
  } catch (e) {
    // Évite un domaine orphelin côté Plesk.
    await deleteDomain(pleskId).catch(() => {})
    return { error: errorMessage(e) }
  }

  void logSuccess({
    category: "plesk",
    title: "Site web créé",
    service: "Site web",
    action: "création",
    result: "success",
    meta: { site: id },
    dedupeKey: `site-created:${id}`,
  })
  await logActivity(user, "Site créé", { type: "site", id, label: domain })
  revalidatePath("/sites")
  redirect(`/sites/${id}`)
}

export async function issueSsl(siteId: string): Promise<ActionState> {
  const user = await requireUser()
  const site = await getAccessibleSite(siteId)
  if (!site) return { error: "Site introuvable" }

  try {
    await issueLetsEncrypt(site.domain, user.email)
  } catch (e) {
    const message = errorMessage(e)
    if (!isPleskConnectivityError(e)) {
      void logError({
        category: "plesk",
        title: "Échec de l'émission du certificat SSL",
        service: "Site web",
        action: "émission SSL",
        result: "failure",
        message: errorText(e),
        meta: { site: site.id },
        dedupeKey: `ssl:${site.id}`,
      })
    }
    await db
      .update(schema.sites)
      .set({ sslLastError: message.slice(0, 500) })
      .where(eq(schema.sites.id, site.id))
    await logActivity(user, "Échec de l'émission du certificat SSL", {
      type: "site",
      id: site.id,
      label: site.domain,
    })
    return { error: message }
  }

  void logSuccess({
    category: "plesk",
    title: "Certificat SSL émis",
    service: "Site web",
    action: "émission SSL",
    result: "success",
    meta: { site: site.id },
    dedupeKey: `ssl-ok:${site.id}`,
  })
  await logActivity(user, "Certificat SSL émis", {
    type: "site",
    id: site.id,
    label: site.domain,
  })
  await db
    .update(schema.sites)
    .set({ sslIssuedAt: new Date(), sslLastError: null })
    .where(eq(schema.sites.id, site.id))
  revalidatePath(`/sites/${site.id}`)
  return undefined
}

export async function deleteSite(siteId: string): Promise<ActionState> {
  const site = await getAccessibleSite(siteId)
  if (!site) return { error: "Site introuvable" }

  try {
    await deleteDomain(site.pleskId)
  } catch (e) {
    // Déjà supprimé côté Plesk : on nettoie quand même la base.
    if (!(e instanceof PleskError && e.status === 404)) {
      if (!isPleskConnectivityError(e)) {
        void logError({
          category: "plesk",
          title: "Échec de suppression d'un site",
          service: "Site web",
          action: "suppression",
          result: "failure",
          message: errorText(e),
          meta: { site: site.id },
          dedupeKey: `site-del:${site.id}`,
        })
      }
      return { error: errorMessage(e) }
    }
  }

  void logWarning({
    category: "plesk",
    title: "Site web supprimé",
    service: "Site web",
    action: "suppression",
    result: "success",
    meta: { site: site.id },
    dedupeKey: `site-deleted:${site.id}`,
  })
  await db.delete(schema.sites).where(eq(schema.sites.id, site.id))
  await logActivity(await requireUser(), "Site supprimé", {
    type: "site",
    id: site.id,
    label: site.domain,
  })
  revalidatePath("/sites")
  redirect("/sites")
}

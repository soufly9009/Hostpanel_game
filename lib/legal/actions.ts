"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { and, asc, eq, gt, lt, desc } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { can, requireStaff } from "@/lib/auth/permissions"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { isUniqueViolation } from "@/lib/db/errors"
import { auditSensitive } from "@/lib/discord/audit"

import { pendingAcceptances, recordAcceptances } from "./service"

export type LegalState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const D = schema.legalDocuments
const S = schema.legalSections
const DENIED = { error: "Permission insuffisante." }
const idSchema = z.string().min(1).max(64)

async function staffWith(key: string) {
  const user = await requireStaff()
  return (await can(user, key)) ? user : null
}

function refresh(docId?: string) {
  revalidatePath("/support/legal")
  if (docId) revalidatePath(`/support/legal/${docId}`)
  revalidatePath("/legal", "layout")
}

async function touch(docId: string, by: string) {
  await db
    .update(D)
    .set({ updatedAt: new Date(), updatedBy: by })
    .where(eq(D.id, docId))
}

/** Pages fixes sous /legal. */
const RESERVED_SLUGS = new Set(["accept", "my-data"])

const docSchema = z.object({
  title: z.string().trim().min(3, "Titre trop court").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Adresse : lettres minuscules, chiffres et tirets"
    )
    .max(60)
    .refine((s) => !RESERVED_SLUGS.has(s), "Adresse réservée"),
  summary: z.string().trim().max(300).optional(),
  position: z.coerce.number().int().min(0).max(999).default(0),
})

/* ───────────── Documents ───────────── */

export async function createDocumentAction(
  _prev: LegalState,
  formData: FormData
): Promise<LegalState> {
  const staff = await staffWith("legal.edit")
  if (!staff) return DENIED
  const parsed = docSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  let id: string
  try {
    const [doc] = await db
      .insert(D)
      .values({
        ...parsed.data,
        summary: parsed.data.summary || null,
        requiresAcceptance: formData.get("requiresAcceptance") !== null,
        updatedBy: staff.email,
      })
      .returning({ id: D.id })
    id = doc.id
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Cette adresse existe déjà." }
    throw e
  }
  await logActivity(staff, "Document légal créé", {
    type: "legal",
    id,
    label: parsed.data.title,
  })
  refresh()
  redirect(`/support/legal/${id}`)
}

export async function updateDocumentAction(
  _prev: LegalState,
  formData: FormData
): Promise<LegalState> {
  const staff = await staffWith("legal.edit")
  if (!staff) return DENIED
  const id = idSchema.safeParse(formData.get("id"))
  const parsed = docSchema.safeParse(Object.fromEntries(formData))
  if (!id.success) return { error: "Document invalide." }
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const [doc] = await db.select().from(D).where(eq(D.id, id.data))
  if (!doc) return { error: "Document introuvable." }

  const requiresAcceptance = formData.get("requiresAcceptance") !== null
  try {
    await db
      .update(D)
      .set({
        ...parsed.data,
        summary: parsed.data.summary || null,
        requiresAcceptance,
        isPublished: formData.get("isPublished") !== null,
        // Rendre un document obligatoire exige l'acceptation de la version
        // en ligne par tous les utilisateurs.
        acceptanceVersion:
          requiresAcceptance && !doc.requiresAcceptance
            ? doc.version
            : doc.acceptanceVersion,
        updatedAt: new Date(),
        updatedBy: staff.email,
      })
      .where(eq(D.id, doc.id))
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Cette adresse existe déjà." }
    throw e
  }
  await logActivity(staff, "Document légal modifié", {
    type: "legal",
    id: doc.id,
    label: parsed.data.title,
  })
  refresh(doc.id)
  return { ok: true, notice: "Document enregistré." }
}

export async function deleteDocumentAction(id: string): Promise<LegalState> {
  const staff = await staffWith("legal.delete")
  if (!staff) return DENIED
  const [doc] = await db
    .delete(D)
    .where(eq(D.id, idSchema.parse(id)))
    .returning()
  if (!doc) return { error: "Document introuvable." }
  await logActivity(staff, "Document légal supprimé", {
    type: "legal",
    id: doc.id,
    label: doc.title,
  })
  auditSensitive(
    staff,
    "Document légal supprimé",
    { document: doc.slug },
    "warning"
  )
  refresh()
  redirect("/support/legal")
}

/* ───────────── Sections (brouillon) ───────────── */

const sectionSchema = z.object({
  heading: z.string().trim().min(1, "Titre requis").max(200),
  body: z.string().trim().min(1, "Contenu requis").max(20_000),
})

export async function addSectionAction(
  _prev: LegalState,
  formData: FormData
): Promise<LegalState> {
  const staff = await staffWith("legal.edit")
  if (!staff) return DENIED
  const docId = idSchema.safeParse(formData.get("documentId"))
  const parsed = sectionSchema.safeParse(Object.fromEntries(formData))
  if (!docId.success) return { error: "Document invalide." }
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const [last] = await db
    .select({ position: S.position })
    .from(S)
    .where(eq(S.documentId, docId.data))
    .orderBy(desc(S.position))
    .limit(1)
  try {
    await db.insert(S).values({
      documentId: docId.data,
      position: (last?.position ?? -1) + 1,
      ...parsed.data,
    })
  } catch {
    return { error: "Document introuvable." }
  }
  await touch(docId.data, staff.email)
  refresh(docId.data)
  return { ok: true, notice: "Section ajoutée au brouillon." }
}

export async function updateSectionAction(
  _prev: LegalState,
  formData: FormData
): Promise<LegalState> {
  const staff = await staffWith("legal.edit")
  if (!staff) return DENIED
  const id = idSchema.safeParse(formData.get("id"))
  const parsed = sectionSchema.safeParse(Object.fromEntries(formData))
  if (!id.success) return { error: "Section invalide." }
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const [sec] = await db
    .update(S)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(S.id, id.data))
    .returning({ documentId: S.documentId })
  if (!sec) return { error: "Section introuvable." }
  await touch(sec.documentId, staff.email)
  refresh(sec.documentId)
  return { ok: true, notice: "Section enregistrée (brouillon)." }
}

export async function deleteSectionAction(id: string): Promise<LegalState> {
  const staff = await staffWith("legal.delete")
  if (!staff) return DENIED
  const [sec] = await db
    .delete(S)
    .where(eq(S.id, idSchema.parse(id)))
    .returning({ documentId: S.documentId, heading: S.heading })
  if (!sec) return { error: "Section introuvable." }
  await touch(sec.documentId, staff.email)
  await logActivity(staff, "Section légale supprimée", {
    type: "legal",
    id: sec.documentId,
    label: sec.heading,
  })
  refresh(sec.documentId)
  return { ok: true }
}

/** Échange la position avec la section voisine. */
export async function moveSectionAction(
  id: string,
  direction: "up" | "down"
): Promise<LegalState> {
  const staff = await staffWith("legal.edit")
  if (!staff) return DENIED
  const [sec] = await db
    .select()
    .from(S)
    .where(eq(S.id, idSchema.parse(id)))
  if (!sec) return { error: "Section introuvable." }

  const [other] = await db
    .select()
    .from(S)
    .where(
      and(
        eq(S.documentId, sec.documentId),
        direction === "up"
          ? lt(S.position, sec.position)
          : gt(S.position, sec.position)
      )
    )
    .orderBy(direction === "up" ? desc(S.position) : asc(S.position))
    .limit(1)
  if (!other) return { ok: true }

  await db.transaction(async (tx) => {
    await tx.update(S).set({ position: other.position }).where(eq(S.id, sec.id))
    await tx.update(S).set({ position: sec.position }).where(eq(S.id, other.id))
  })
  await touch(sec.documentId, staff.email)
  refresh(sec.documentId)
  return { ok: true }
}

/* ───────────── Publication ───────────── */

export async function publishDocumentAction(
  _prev: LegalState,
  formData: FormData
): Promise<LegalState> {
  const staff = await staffWith("legal.publish")
  if (!staff) return DENIED
  const id = idSchema.safeParse(formData.get("id"))
  if (!id.success) return { error: "Document invalide." }
  const changeNote = String(formData.get("changeNote") ?? "")
    .trim()
    .slice(0, 300)
  const major = formData.get("minor") === null

  const [doc] = await db.select().from(D).where(eq(D.id, id.data))
  if (!doc) return { error: "Document introuvable." }
  const sections = await db
    .select({ heading: S.heading, body: S.body })
    .from(S)
    .where(eq(S.documentId, doc.id))
    .orderBy(asc(S.position))
  if (sections.length === 0) return { error: "Ajoute au moins une section." }

  // Une première publication est toujours majeure.
  const isMajor = major || doc.version === 0
  const version = doc.version + 1
  const now = new Date()
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.legalVersions).values({
        documentId: doc.id,
        version,
        title: doc.title,
        content: sections,
        changeNote: changeNote || null,
        major: isMajor,
        publishedBy: staff.email,
      })
      // Mise à jour conditionnelle : deux publications simultanées ne
      // peuvent pas produire le même numéro de version.
      const res = await tx
        .update(D)
        .set({
          version,
          acceptanceVersion:
            isMajor && doc.requiresAcceptance ? version : doc.acceptanceVersion,
          publishedAt: now,
          updatedAt: now,
          updatedBy: staff.email,
        })
        .where(and(eq(D.id, doc.id), eq(D.version, doc.version)))
      if (res.rowsAffected !== 1) throw new Error("conflict")
    })
  } catch (e) {
    if (
      isUniqueViolation(e) ||
      (e instanceof Error && e.message === "conflict")
    ) {
      return {
        error: "Une autre publication vient d'avoir lieu : recharge la page.",
      }
    }
    throw e
  }

  await logActivity(staff, `Document légal publié (v${version})`, {
    type: "legal",
    id: doc.id,
    label: doc.title,
  })
  auditSensitive(staff, "Document légal publié", {
    document: doc.slug,
    version,
    majeure: isMajor,
  })
  refresh(doc.id)
  return {
    ok: true,
    notice:
      isMajor && doc.requiresAcceptance
        ? `Version ${version} publiée : les utilisateurs devront l'accepter à leur prochaine visite.`
        : `Version ${version} publiée.`,
  }
}

/* ───────────── Acceptation par l'utilisateur ───────────── */

export async function acceptPendingAction(
  _prev: LegalState,
  formData: FormData
): Promise<LegalState> {
  const user = await requireUser()
  if (formData.get("accept") === null) {
    return { error: "Coche la case pour accepter." }
  }
  const pending = await pendingAcceptances(user.id)
  // N'accepte que les versions affichées (une publication entre-temps
  // redemande l'acceptation).
  const shown = new Map(
    formData
      .getAll("doc")
      .map(String)
      .map((v) => v.split(":") as [string, string])
  )
  const docs = pending.filter((d) => shown.get(d.id) === String(d.version))
  await recordAcceptances(user.id, docs)
  await logActivity(user, "Conditions acceptées", {
    type: "legal",
    label: docs.map((d) => `${d.slug} v${d.version}`).join(", "),
  })
  if (docs.length < pending.length) {
    return { error: "Les documents ont changé : relis la nouvelle version." }
  }
  redirect("/dashboard")
}

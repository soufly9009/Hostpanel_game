import "server-only"

import { and, asc, desc, eq, gt, inArray, max } from "drizzle-orm"

import { siteConfig } from "@/lib/config/site"
import { db, schema } from "@/lib/db"

import { legalTemplates } from "./defaults"

const SEED_KEY = "legal.seeded"

let seeding: Promise<void> | null = null

/**
 * Publie les modèles par défaut (version 1) une seule fois : un document
 * supprimé ensuite par l'exploitant n'est pas recréé.
 */
export function ensureLegalSeed() {
  seeding ??= seed().catch((e) => {
    seeding = null
    console.error("[legal] initialisation impossible", e)
  })
  return seeding
}

async function seed() {
  const [done] = await db
    .select({ key: schema.appSettings.key })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SEED_KEY))
  if (done) return

  await db.transaction(async (tx) => {
    for (const t of legalTemplates(siteConfig.name)) {
      const [doc] = await tx
        .insert(schema.legalDocuments)
        .values({
          slug: t.slug,
          title: t.title,
          summary: t.summary,
          requiresAcceptance: t.requiresAcceptance,
          position: t.position,
          version: 1,
          acceptanceVersion: t.requiresAcceptance ? 1 : 0,
          publishedAt: new Date(),
          updatedBy: "système",
        })
        .onConflictDoNothing()
        .returning()
      if (!doc) continue
      await tx.insert(schema.legalSections).values(
        t.sections.map((s, i) => ({
          documentId: doc.id,
          position: i,
          heading: s.heading,
          body: s.body,
        }))
      )
      await tx.insert(schema.legalVersions).values({
        documentId: doc.id,
        version: 1,
        title: t.title,
        content: t.sections,
        changeNote: "Version initiale (modèle à compléter)",
        major: true,
        publishedBy: "système",
      })
    }
    await tx
      .insert(schema.appSettings)
      .values({ key: SEED_KEY, value: true })
      .onConflictDoNothing()
  })
}

const D = schema.legalDocuments

/** Documents visibles publiquement (publiés au moins une fois). */
export async function listPublicDocuments() {
  await ensureLegalSeed()
  return db
    .select()
    .from(D)
    .where(and(eq(D.isPublished, true), gt(D.version, 0)))
    .orderBy(asc(D.position), asc(D.title))
}

/** Version publiée d'un document (la dernière, ou celle demandée). */
export async function getPublishedDocument(slug: string, version?: number) {
  await ensureLegalSeed()
  const [doc] = await db.select().from(D).where(eq(D.slug, slug))
  if (!doc || !doc.isPublished || doc.version === 0) return null
  const V = schema.legalVersions
  const [ver] = await db
    .select()
    .from(V)
    .where(
      and(
        eq(V.documentId, doc.id),
        eq(V.version, version && version > 0 ? version : doc.version)
      )
    )
  if (!ver) return null
  const history = await db
    .select({
      version: V.version,
      publishedAt: V.publishedAt,
      changeNote: V.changeNote,
      major: V.major,
    })
    .from(V)
    .where(eq(V.documentId, doc.id))
    .orderBy(desc(V.version))
  return { doc, ver, history }
}

/** Documents dont l'acceptation est obligatoire, dans leur version courante. */
export async function requiredDocuments() {
  await ensureLegalSeed()
  return db
    .select()
    .from(D)
    .where(
      and(
        eq(D.requiresAcceptance, true),
        eq(D.isPublished, true),
        gt(D.version, 0)
      )
    )
    .orderBy(asc(D.position))
}

/** Documents obligatoires que l'utilisateur n'a pas (ou plus) acceptés. */
export async function pendingAcceptances(userId: string) {
  const docs = await requiredDocuments()
  if (docs.length === 0) return []
  const A = schema.legalAcceptances
  const rows = await db
    .select({ documentId: A.documentId, v: max(A.version) })
    .from(A)
    .where(
      and(
        eq(A.userId, userId),
        inArray(
          A.documentId,
          docs.map((d) => d.id)
        )
      )
    )
    .groupBy(A.documentId)
  const accepted = new Map(rows.map((r) => [r.documentId, r.v ?? 0]))
  return docs.filter(
    (d) => (accepted.get(d.id) ?? 0) < Math.max(d.acceptanceVersion, 1)
  )
}

/** Enregistre l'acceptation de la version courante de ces documents. */
export async function recordAcceptances(
  userId: string,
  docs: { id: string; version: number }[]
) {
  if (docs.length === 0) return
  await db
    .insert(schema.legalAcceptances)
    .values(docs.map((d) => ({ userId, documentId: d.id, version: d.version })))
    .onConflictDoNothing()
}

export async function userAcceptances(userId: string) {
  const A = schema.legalAcceptances
  return db
    .select({
      title: D.title,
      slug: D.slug,
      version: A.version,
      acceptedAt: A.acceptedAt,
    })
    .from(A)
    .innerJoin(D, eq(D.id, A.documentId))
    .where(eq(A.userId, userId))
    .orderBy(desc(A.acceptedAt))
}

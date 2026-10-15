"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { can, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"
import { isUniqueViolation } from "@/lib/db/errors"

export type ContentState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const DENIED = { error: "Permission insuffisante." }

async function editor() {
  const user = await requireStaff()
  return (await can(user, "content.manage")) ? user : null
}

function refresh() {
  revalidatePath("/support/content")
  revalidatePath("/news", "layout")
  revalidatePath("/help", "layout")
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)

const slugField = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((s) => (s ? slugify(s) : ""))

/* ───────────── Annonces ───────────── */

const announcementSchema = z.object({
  title: z.string().trim().min(3, "Titre trop court").max(160),
  slug: slugField,
  summary: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1, "Contenu requis").max(20_000),
})

export async function saveAnnouncementAction(
  _prev: ContentState,
  formData: FormData
): Promise<ContentState> {
  const user = await editor()
  if (!user) return DENIED
  const parsed = announcementSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const id = String(formData.get("id") ?? "")
  const publish = formData.get("isPublished") !== null
  const slug = parsed.data.slug || slugify(parsed.data.title)
  if (!slug) return { error: "Adresse invalide" }

  const [existing] = id
    ? await db
        .select()
        .from(schema.announcements)
        .where(eq(schema.announcements.id, id))
    : []
  if (id && !existing) return { error: "Annonce introuvable" }

  const values = {
    title: parsed.data.title,
    slug,
    summary: parsed.data.summary || null,
    body: parsed.data.body,
    isPublished: publish,
    // Date de publication fixée à la première mise en ligne.
    publishedAt: publish
      ? (existing?.publishedAt ?? new Date())
      : (existing?.publishedAt ?? null),
    author: user.email,
    updatedAt: new Date(),
  }
  try {
    if (existing) {
      await db
        .update(schema.announcements)
        .set(values)
        .where(eq(schema.announcements.id, existing.id))
    } else {
      await db.insert(schema.announcements).values(values)
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Cette adresse existe déjà." }
    throw e
  }
  await logActivity(user, existing ? "Annonce modifiée" : "Annonce créée", {
    type: "content",
    label: values.title,
  })
  refresh()
  return {
    ok: true,
    notice: publish ? "Annonce publiée." : "Brouillon enregistré.",
  }
}

export async function deleteAnnouncementAction(
  id: string
): Promise<ContentState> {
  const user = await editor()
  if (!user) return DENIED
  const [a] = await db
    .delete(schema.announcements)
    .where(eq(schema.announcements.id, z.string().max(64).parse(id)))
    .returning()
  if (!a) return { error: "Annonce introuvable" }
  await logActivity(user, "Annonce supprimée", {
    type: "content",
    label: a.title,
  })
  refresh()
  return { ok: true }
}

/* ───────────── Base de connaissances ───────────── */

const categorySchema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(80),
  slug: slugField,
  description: z.string().trim().max(200).optional(),
  position: z.coerce.number().int().min(0).max(999).default(0),
})

export async function saveCategoryAction(
  _prev: ContentState,
  formData: FormData
): Promise<ContentState> {
  const user = await editor()
  if (!user) return DENIED
  const parsed = categorySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const id = String(formData.get("id") ?? "")
  const values = {
    name: parsed.data.name,
    slug: parsed.data.slug || slugify(parsed.data.name),
    description: parsed.data.description || null,
    position: parsed.data.position,
  }
  try {
    if (id) {
      await db
        .update(schema.kbCategories)
        .set(values)
        .where(eq(schema.kbCategories.id, id))
    } else {
      await db.insert(schema.kbCategories).values(values)
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Cette adresse existe déjà." }
    throw e
  }
  refresh()
  return { ok: true, notice: "Catégorie enregistrée." }
}

/** Les articles de la catégorie deviennent « sans catégorie ». */
export async function deleteCategoryAction(id: string): Promise<ContentState> {
  const user = await editor()
  if (!user) return DENIED
  const cid = z.string().max(64).parse(id)
  await db
    .update(schema.kbArticles)
    .set({ categoryId: null })
    .where(eq(schema.kbArticles.categoryId, cid))
  await db.delete(schema.kbCategories).where(eq(schema.kbCategories.id, cid))
  refresh()
  return { ok: true }
}

const articleSchema = z.object({
  title: z.string().trim().min(3, "Titre trop court").max(160),
  slug: slugField,
  categoryId: z.string().max(64).optional(),
  body: z.string().trim().min(1, "Contenu requis").max(50_000),
})

export async function saveArticleAction(
  _prev: ContentState,
  formData: FormData
): Promise<ContentState> {
  const user = await editor()
  if (!user) return DENIED
  const parsed = articleSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const id = String(formData.get("id") ?? "")
  const values = {
    title: parsed.data.title,
    slug: parsed.data.slug || slugify(parsed.data.title),
    categoryId: parsed.data.categoryId || null,
    body: parsed.data.body,
    isPublished: formData.get("isPublished") !== null,
    author: user.email,
    updatedAt: new Date(),
  }
  try {
    if (id) {
      await db
        .update(schema.kbArticles)
        .set(values)
        .where(eq(schema.kbArticles.id, id))
    } else {
      await db.insert(schema.kbArticles).values(values)
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Cette adresse existe déjà." }
    throw e
  }
  await logActivity(
    user,
    id ? "Article d'aide modifié" : "Article d'aide créé",
    {
      type: "content",
      label: values.title,
    }
  )
  refresh()
  return {
    ok: true,
    notice: values.isPublished ? "Article publié." : "Brouillon enregistré.",
  }
}

export async function deleteArticleAction(id: string): Promise<ContentState> {
  const user = await editor()
  if (!user) return DENIED
  const [a] = await db
    .delete(schema.kbArticles)
    .where(eq(schema.kbArticles.id, z.string().max(64).parse(id)))
    .returning()
  if (!a) return { error: "Article introuvable" }
  await logActivity(user, "Article d'aide supprimé", {
    type: "content",
    label: a.title,
  })
  refresh()
  return { ok: true }
}

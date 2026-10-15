import "server-only"

import { and, count, eq, isNull } from "drizzle-orm"

import { db, schema } from "@/lib/db"

/**
 * Crée une notification, une seule fois par (utilisateur, dedupeKey).
 * Retourne true si elle vient d'être créée.
 */
export async function notify(input: {
  userId: string
  dedupeKey: string
  title: string
  body?: string
  href?: string
  level?: "info" | "warning" | "error"
}) {
  const res = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      dedupeKey: input.dedupeKey,
      title: input.title,
      body: input.body,
      href: input.href,
      level: input.level ?? "info",
    })
    .onConflictDoNothing()
  return res.rowsAffected === 1
}

export async function unreadCount(userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt)
      )
    )
  return row?.n ?? 0
}

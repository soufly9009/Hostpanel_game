"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"

import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

/** Marque une notification (ou toutes) comme lue — toujours limité à l'utilisateur courant. */
export async function markNotificationRead(id: string | null) {
  const user = await requireUser()
  const N = schema.notifications
  await db
    .update(N)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(N.userId, user.id),
        isNull(N.readAt),
        id ? eq(N.id, id) : undefined
      )
    )
  revalidatePath("/notifications")
  revalidatePath("/dashboard")
}

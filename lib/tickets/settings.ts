import "server-only"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/lib/db"

const KEY = "tickets"

const settingsSchema = z.object({
  /** Réponse automatique IA au premier message d'un ticket. */
  aiAutoReply: z.boolean(),
})
export type TicketSettings = z.infer<typeof settingsSchema>

export const DEFAULT_TICKET_SETTINGS: TicketSettings = { aiAutoReply: true }

export async function getTicketSettings(): Promise<TicketSettings> {
  try {
    const [row] = await db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, KEY))
    const parsed = settingsSchema.safeParse(row?.value)
    if (parsed.success) return parsed.data
  } catch {
    // table absente : défauts
  }
  return DEFAULT_TICKET_SETTINGS
}

export async function saveTicketSettings(input: unknown) {
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) return false
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value: parsed.data })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: parsed.data, updatedAt: new Date() },
    })
  return true
}

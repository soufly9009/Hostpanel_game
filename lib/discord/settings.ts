import "server-only"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/lib/db"

/** Préférences non secrètes de supervision (stockées dans app_settings). */

const KEY = "discord"

export const settingsSchema = z.object({
  /** Interrupteur général (le webhook reste dans l'environnement). */
  enabled: z.boolean(),
  minLevel: z.enum(["info", "warning", "error", "critical"]),
  categories: z.array(z.enum(schema.EVENT_CATEGORIES)).max(30),
})
export type DiscordSettings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: DiscordSettings = {
  enabled: true,
  minLevel: "info",
  categories: [...schema.EVENT_CATEGORIES],
}

let cache: { at: number; value: DiscordSettings } | null = null
const TTL = 15_000

export async function getDiscordSettings(): Promise<DiscordSettings> {
  if (cache && Date.now() - cache.at < TTL) return cache.value
  let value = DEFAULT_SETTINGS
  try {
    const [row] = await db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, KEY))
    if (row) {
      const parsed = settingsSchema.safeParse(row.value)
      if (parsed.success) value = parsed.data
    }
  } catch {
    // table absente (migration non appliquée) : valeurs par défaut
  }
  cache = { at: Date.now(), value }
  return value
}

export async function saveDiscordSettings(input: unknown) {
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: "Préférences invalides" }
  }
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value: parsed.data })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: parsed.data, updatedAt: new Date() },
    })
  cache = null
  return { ok: true as const, value: parsed.data }
}

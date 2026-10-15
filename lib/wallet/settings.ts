import "server-only"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/lib/db"

const KEY = "wallet"

const settingsSchema = z.object({
  /** Débiter le prix de l'offre (en crédits) à la commande et au renouvellement. */
  billingEnabled: z.boolean(),
  /** Crédits offerts à l'inscription (0 = aucun). */
  signupBonusCents: z.number().int().min(0).max(100_000_000),
})
export type WalletSettings = z.infer<typeof settingsSchema>

export const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  billingEnabled: false,
  signupBonusCents: 0,
}

export async function getWalletSettings(): Promise<WalletSettings> {
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
  return DEFAULT_WALLET_SETTINGS
}

export async function saveWalletSettings(input: unknown) {
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

"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth/session"
import { schema } from "@/lib/db"

import { auditSensitive } from "./audit"
import { flushPending } from "./logging"
import { saveDiscordSettings } from "./settings"

export type DiscordFormState =
  { error?: string; ok?: boolean; notice?: string } | undefined

/** Enregistre les préférences non secrètes (jamais l'URL du webhook). */
export async function saveDiscordSettingsAction(
  _prev: DiscordFormState,
  formData: FormData
): Promise<DiscordFormState> {
  const admin = await requireAdmin()

  const categories = formData
    .getAll("categories")
    .map(String)
    .filter((c): c is (typeof schema.EVENT_CATEGORIES)[number] =>
      (schema.EVENT_CATEGORIES as readonly string[]).includes(c)
    )

  const res = await saveDiscordSettings({
    enabled: formData.get("enabled") === "on",
    minLevel: String(formData.get("minLevel") ?? "info"),
    categories,
  })
  if (!res.ok) return { error: res.error }

  auditSensitive(admin, "Préférences de notification Discord modifiées", {
    niveau: res.value.minLevel,
    catégories: res.value.categories.length,
    actif: res.value.enabled,
  })
  revalidatePath("/admin/integrations/discord")
  return { ok: true, notice: "Préférences enregistrées." }
}

/** Relance immédiate de la file (événements en attente). */
export async function flushDiscordQueueAction(): Promise<DiscordFormState> {
  await requireAdmin()
  const r = await flushPending(20)
  revalidatePath("/admin/integrations/discord")
  return {
    ok: true,
    notice: `${r.sent} envoyé(s) sur ${r.processed} traité(s).`,
  }
}

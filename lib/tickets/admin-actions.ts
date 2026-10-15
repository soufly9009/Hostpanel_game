"use server"

import { revalidatePath } from "next/cache"

import { aiConfigured, generateTicketReply } from "@/lib/ai/openrouter"
import { requireAdmin } from "@/lib/auth/session"
import { auditSensitive } from "@/lib/discord/audit"

import { saveTicketSettings } from "./settings"

export type SupportAdminState =
  { error?: string; ok?: boolean; notice?: string } | undefined

export async function saveTicketSettingsAction(
  _prev: SupportAdminState,
  formData: FormData
): Promise<SupportAdminState> {
  const admin = await requireAdmin()
  const aiAutoReply = formData.get("aiAutoReply") === "on"
  if (!(await saveTicketSettings({ aiAutoReply }))) {
    return { error: "Préférences invalides" }
  }
  auditSensitive(admin, "Réponse automatique IA des tickets", {
    actif: aiAutoReply,
  })
  revalidatePath("/admin/support")
  return { ok: true, notice: "Préférences enregistrées." }
}

/** Vérifie la clé et un modèle gratuit sans créer de ticket. */
export async function testAiAction(): Promise<SupportAdminState> {
  await requireAdmin()
  if (!aiConfigured()) {
    return { error: "OPENROUTER_API_KEY est absente de l'environnement." }
  }
  const res = await generateTicketReply({
    subject: "Test de connexion",
    category: "other",
    messages: [
      { from: "customer", body: "Bonjour, mon VPS ne répond plus au ping." },
    ],
  })
  if (!res.ok) return { error: res.detail }
  return { ok: true, notice: `Réponse obtenue avec ${res.model}.` }
}

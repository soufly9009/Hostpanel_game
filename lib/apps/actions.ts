"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireUser } from "@/lib/auth/session"
import { hostExecConfigured } from "@/lib/proxmox/exec"
import { getAccessibleServer } from "@/lib/servers/access"

import { APP_IDS, appById } from "./catalog"
import { queueInstalls } from "./service"

export type AppsState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const idsSchema = z
  .array(z.string().refine((s) => APP_IDS.includes(s)))
  .min(1)
  .max(APP_IDS.length)

export async function installAppsAction(
  serverId: string,
  appIds: string[]
): Promise<AppsState> {
  const user = await requireUser()
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }
  if (server.virt !== "lxc")
    return { error: "Réservé aux VPS conteneurs (LXC)." }
  if (server.suspended) return { error: "VPS suspendu." }
  if (!hostExecConfigured)
    return { error: "Installation indisponible : contacte le support." }
  const ids = idsSchema.safeParse(appIds)
  if (!ids.success) return { error: "Choisis au moins une application." }

  const queued = await queueInstalls(server, ids.data, user.email)
  if (queued.length === 0)
    return { error: "Ces applications sont déjà installées ou en cours." }
  await logActivity(user, `Installation demandée : ${queued.join(", ")}`, {
    type: "server",
    id: server.id,
    label: server.name,
  })
  revalidatePath(`/servers/${server.id}`)
  const names = queued.map((id) => appById(id)?.name ?? id).join(", ")
  return {
    ok: true,
    notice: `Installation lancée : ${names}. Tu peux quitter la page, une notification t'avertira.`,
  }
}

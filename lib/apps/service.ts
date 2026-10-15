import "server-only"

import { and, asc, eq, inArray, lt } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { db, schema } from "@/lib/db"
import { errorText, logError } from "@/lib/discord/logging"
import { notify } from "@/lib/notifications"
import {
  ensureDockerFeatures,
  hostExecConfigured,
  pctExec,
  pctStatus,
} from "@/lib/proxmox/exec"

import { appById, withDependencies } from "./catalog"
import { installScript } from "./scripts"

/**
 * Installation d'applications dans un LXC : une file par VPS, traitée en
 * arrière-plan (une installation à la fois), reprise chaque minute par le
 * planificateur. Instance unique (état « en cours » sur globalThis).
 */

const LOG_MAX = 8000
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

const g = globalThis as unknown as { __appQueues?: Set<string> }
const busy = (g.__appQueues ??= new Set())

type Server = typeof schema.servers.$inferSelect

/** Met en file les applications (et leurs dépendances) pas encore installées. */
export async function queueInstalls(
  server: Server,
  appIds: string[],
  actor: string
) {
  const A = schema.appInstalls
  const existing = await db
    .select({ appId: A.appId, status: A.status })
    .from(A)
    .where(eq(A.serverId, server.id))
  const skip = new Set(
    existing.filter((e) => e.status !== "failed").map((e) => e.appId)
  )
  const wanted = withDependencies(appIds).filter((id) => !skip.has(id))
  if (wanted.length === 0) return []
  await db
    .insert(A)
    .values(
      wanted.map((appId) => ({
        serverId: server.id,
        appId,
        requestedBy: actor,
      }))
    )
  void processQueue(server.id)
  return wanted
}

async function waitRunning(vmid: number, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if ((await pctStatus(vmid).catch(() => "unknown")) === "running")
      return true
    await new Promise((r) => setTimeout(r, 5000))
  }
  return false
}

async function runOne(install: schema.AppInstall, server: Server) {
  const app = appById(install.appId)
  const script = installScript(install.appId)
  if (!app || !script) throw new Error("Application inconnue")
  if (!hostExecConfigured) {
    throw new Error(
      "Accès SSH à l'hôte Proxmox non configuré (PROXMOX_SSH_PASSWORD)."
    )
  }
  if (server.virt !== "lxc") throw new Error("Réservé aux conteneurs LXC.")
  if (!(await waitRunning(server.vmid))) {
    throw new Error(
      "Le VPS n'est pas démarré : démarre-le puis relance l'installation."
    )
  }
  let prefix = ""
  if (app.needsNesting && (await ensureDockerFeatures(server.vmid))) {
    prefix =
      "Options du conteneur activées (nesting, keyctl) : VPS redémarré.\n"
    if (!(await waitRunning(server.vmid)))
      throw new Error("Le VPS n'a pas redémarré.")
    await new Promise((r) => setTimeout(r, 8000)) // réseau
  }
  const res = await pctExec(server.vmid, script)
  return { ok: res.code === 0, log: prefix + res.output, code: res.code }
}

/** Traite la file d'un VPS, une installation après l'autre. */
export async function processQueue(serverId: string) {
  if (busy.has(serverId)) return
  busy.add(serverId)
  const A = schema.appInstalls
  try {
    for (;;) {
      const [next] = await db
        .select()
        .from(A)
        .where(and(eq(A.serverId, serverId), eq(A.status, "queued")))
        .orderBy(asc(A.createdAt))
        .limit(1)
      if (!next) break
      const claim = await db
        .update(A)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(A.id, next.id), eq(A.status, "queued")))
      if (claim.rowsAffected !== 1) continue

      const [server] = await db
        .select()
        .from(schema.servers)
        .where(eq(schema.servers.id, serverId))
      if (!server) break // VPS supprimé : la suppression en cascade nettoie la file

      let ok = false
      let log = ""
      try {
        const r = await runOne(next, server)
        ok = r.ok
        log = r.ok ? r.log : `${r.log}\n\n[code de sortie ${r.code}]`
      } catch (e) {
        log = errorText(e)
      }
      log = log.replace(ANSI, "").replace(/\r/g, "")
      if (log.length > LOG_MAX) log = "…\n" + log.slice(-LOG_MAX)

      await db
        .update(A)
        .set({ status: ok ? "success" : "failed", log, finishedAt: new Date() })
        .where(eq(A.id, next.id))

      const name = appById(next.appId)?.name ?? next.appId
      await notify({
        userId: server.userId,
        dedupeKey: `app:${next.id}`,
        title: ok
          ? `${name} installé sur ${server.name}`
          : `Échec de l'installation de ${name}`,
        href: `/servers/${server.id}?tab=apps`,
        level: ok ? "info" : "error",
      })
      await logActivity(null, `${name} ${ok ? "installé" : "non installé"}`, {
        type: "server",
        id: server.id,
        label: server.name,
      })
      if (!ok) {
        void logError({
          category: "vps",
          title: "Échec d'installation d'une application",
          service: "VPS client",
          action: `installation ${next.appId}`,
          result: "failure",
          message: log.slice(-300),
          meta: { vps: server.id },
          dedupeKey: `app-fail:${server.id}:${next.appId}`,
        })
      }
    }
  } finally {
    busy.delete(serverId)
  }
}

/**
 * Reprise (chaque minute) : relance les files en attente et clôt les
 * installations « en cours » orphelines (redémarrage du panel).
 */
export async function resumeAppQueues() {
  const A = schema.appInstalls
  const stale = new Date(Date.now() - 30 * 60_000)
  const running = await db
    .select({ id: A.id, serverId: A.serverId })
    .from(A)
    .where(and(eq(A.status, "running"), lt(A.startedAt, stale)))
  const orphans = running.filter((r) => !busy.has(r.serverId)).map((r) => r.id)
  if (orphans.length) {
    await db
      .update(A)
      .set({
        status: "failed",
        log: "Installation interrompue (redémarrage du panel).",
        finishedAt: new Date(),
      })
      .where(inArray(A.id, orphans))
  }
  const queued = await db
    .selectDistinct({ serverId: A.serverId })
    .from(A)
    .where(eq(A.status, "queued"))
  for (const q of queued) void processQueue(q.serverId)
}

"use server"

import { revalidatePath } from "next/cache"
import { and, eq, gte, lt, or } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { auditSensitive } from "@/lib/discord/audit"
import { db, schema } from "@/lib/db"
import { destroyServer, setSuspended } from "@/lib/provision"
import { ProxmoxError } from "@/lib/proxmox/client"
import { runRenewalCheck } from "@/lib/renewals"

export type AdminState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const errorMessage = (e: unknown) =>
  e instanceof ProxmoxError
    ? `Proxmox : ${e.message}`
    : e instanceof Error
      ? e.message
      : "Erreur inconnue"

const int = (min = 0) => z.coerce.number().int().min(min)

const planSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  priceEuros: z.coerce.number().min(0).max(10_000),
  virt: z.enum(["lxc", "qemu"]),
  node: z.string().trim().min(1, "Nœud requis"),
  storage: z.string().trim().min(1, "Stockage requis"),
  bridge: z.string().trim().min(1).default("vmbr0"),
  template: z.string().trim().min(1, "Template requis"),
  cores: int(1).max(128),
  memoryMb: int(128),
  diskGb: int(1),
  swapMb: int(),
  /** Vide = durée par défaut du site (RENEW_PERIOD_DAYS). */
  periodDays: z
    .union([z.literal(""), int(1).max(365)])
    .transform((v) => (v === "" ? null : v))
    .default(null),
  snapshotLimit: int().max(50).default(3),
  networkModes: z.enum(["dhcp", "static", "both"]).default("dhcp"),
})

export async function createPlan(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const admin = await requireAdmin()

  const parsed = planSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { error: `${issue?.path.join(".")} : ${issue?.message}` }
  }
  const {
    priceEuros,
    diskGb,
    virt,
    node,
    storage,
    bridge,
    template,
    cores,
    ...rest
  } = parsed.data

  if (virt === "qemu" && !/^\d+$/.test(template)) {
    return { error: "template : pour QEMU, indique le VMID du template" }
  }
  if (virt === "lxc" && !template.includes(":")) {
    return {
      error: "template : pour LXC, indique le volid (local:vztmpl/…)",
    }
  }

  // Templates proposés à la réinstallation (le template par défaut en fait partie).
  const extra = formData.getAll("allowedTemplates").flatMap((raw) => {
    try {
      const t = JSON.parse(String(raw))
      return typeof t?.value === "string" && typeof t?.label === "string"
        ? [{ value: t.value.slice(0, 300), label: t.label.slice(0, 120) }]
        : []
    } catch {
      return []
    }
  })
  const byValue = new Map(extra.map((t) => [t.value, t]))
  if (!byValue.has(template)) {
    byValue.set(template, {
      value: template,
      label:
        virt === "lxc"
          ? (template.split("/").pop() ?? template)
          : `VMID ${template}`,
    })
  }
  const templates = [...byValue.values()].slice(0, 50)

  await db.insert(schema.plans).values({
    ...rest,
    priceCents: Math.round(priceEuros * 100),
    diskMb: diskGb * 1024,
    proxmox: { virt, node, storage, bridge, template, cores, templates },
  })

  auditSensitive(admin, "Création d'une offre", { offre: parsed.data.name })
  revalidatePath("/admin/plans")
  revalidatePath("/")
  return { ok: true }
}

export async function togglePlan(planId: string, isActive: boolean) {
  const admin = await requireAdmin()
  await db
    .update(schema.plans)
    .set({ isActive })
    .where(eq(schema.plans.id, planId))
  auditSensitive(admin, isActive ? "Offre activée" : "Offre désactivée", {
    offre: planId.slice(0, 8),
  })
  revalidatePath("/admin/plans")
  revalidatePath("/")
}

export async function deletePlan(planId: string) {
  const admin = await requireAdmin()
  await db.delete(schema.plans).where(eq(schema.plans.id, planId))
  auditSensitive(
    admin,
    "Offre supprimée",
    { offre: planId.slice(0, 8) },
    "warning"
  )
  revalidatePath("/admin/plans")
  revalidatePath("/")
}

export async function setServerSuspended(
  serverId: string,
  suspended: boolean
): Promise<AdminState> {
  const admin = await requireAdmin()
  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
  if (!server) return { error: "VPS introuvable" }

  try {
    await setSuspended(server, suspended)
  } catch (e) {
    return { error: errorMessage(e) }
  }
  await db
    .update(schema.servers)
    .set({ suspended })
    .where(eq(schema.servers.id, serverId))
  auditSensitive(
    admin,
    suspended ? "VPS suspendu par un administrateur" : "Suspension levée",
    { vps: serverId.slice(0, 8) },
    "warning"
  )
  revalidatePath("/admin/servers")
  return { ok: true }
}

export async function adminDeleteServer(serverId: string): Promise<AdminState> {
  const admin = await requireAdmin()
  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
  if (!server) return { error: "VPS introuvable" }

  try {
    await destroyServer(server)
  } catch (e) {
    return { error: errorMessage(e) }
  }
  await db.delete(schema.servers).where(eq(schema.servers.id, serverId))
  auditSensitive(
    admin,
    "VPS supprimé par un administrateur",
    {
      vps: serverId.slice(0, 8),
    },
    "warning"
  )
  revalidatePath("/admin/servers")
  return { ok: true }
}

export async function setServerLimit(userId: string, formData: FormData) {
  const admin = await requireAdmin()
  const limit = int().max(1000).safeParse(formData.get("serverLimit"))
  if (!limit.success) return
  await db
    .update(schema.users)
    .set({ serverLimit: limit.data })
    .where(eq(schema.users.id, userId))
  auditSensitive(admin, "Limite de VPS modifiée", {
    client: userId.slice(0, 8),
    limite: limit.data,
  })
  revalidatePath("/admin/users")
}

export async function runRenewalsNow(): Promise<AdminState> {
  await requireAdmin()
  try {
    const r = await runRenewalCheck({ force: true })
    revalidatePath("/admin")
    revalidatePath("/admin/servers")
    if (!r) return { error: "Vérification déjà en cours" }
    return {
      ok: true,
      notice: `${r.checked} VPS vérifiés · ${r.suspended} suspendu(s) · ${r.deleted} supprimé(s)${
        r.errors.length ? ` · ${r.errors.length} erreur(s)` : ""
      }`,
    }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}

export type LogClearScope = "all" | "older7d" | "older1d" | "errors"

/** Efface tout ou une partie du journal Proxmox. */
export async function clearProxmoxLogs(
  scope: LogClearScope
): Promise<AdminState> {
  const admin = await requireAdmin()
  const L = schema.proxmoxLogs

  let condition
  switch (scope) {
    case "all":
      condition = undefined
      break
    case "older7d":
      condition = lt(L.createdAt, new Date(Date.now() - 7 * 86_400_000))
      break
    case "older1d":
      condition = lt(L.createdAt, new Date(Date.now() - 86_400_000))
      break
    case "errors":
      condition = or(eq(L.status, 0), gte(L.status, 400))
      break
    default:
      return { error: "Portée invalide" }
  }

  try {
    const res = condition
      ? await db.delete(L).where(and(condition))
      : await db.delete(L)
    auditSensitive(admin, "Journal Proxmox purgé", { portée: scope }, "warning")
    revalidatePath("/admin/logs")
    return { ok: true, notice: `${res.rowsAffected} entrée(s) supprimée(s)` }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}

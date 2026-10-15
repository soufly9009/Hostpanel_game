"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { and, count, eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import {
  errorText,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  newCorrelationId,
} from "@/lib/discord/logging"
import { requireUser } from "@/lib/auth/session"
import { getAccessibleServer } from "@/lib/servers/access"
import { db, schema } from "@/lib/db"
import { allowedTemplates, templateLabel } from "@/lib/plans"
import { destroyServer, powerServer, setSuspended } from "@/lib/provision"
import { enableRootSsh } from "@/lib/proxmox/exec"
import { env } from "@/lib/env"
import {
  extendedExpiry,
  maxExpiry,
  newExpiry,
  nextRenewalAt,
} from "@/lib/renewals"
import { cancelReservation, confirmAssignment } from "@/lib/ipam/service"
import { resolveNetwork, specForServer } from "@/lib/servers/network-plan"
import {
  invoiceOrder,
  invoicingFor,
  orderGraceExpiry,
  renewalInvoice,
  tryAutoPay,
} from "@/lib/billing/service"
import { chargeForPlan, refundCharge } from "@/lib/wallet/billing"
import { emitEvent } from "@/lib/webhooks/service"
import {
  createVps,
  getVpsAddresses,
  isConnectivityError,
  nextVmid,
  ProxmoxError,
  toHostname,
  vpsExists,
  type VpsSignal,
} from "@/lib/proxmox/client"

export type ActionState = { error?: string } | undefined

const errorMessage = (e: unknown) =>
  e instanceof ProxmoxError
    ? `Proxmox : ${e.message}`
    : e instanceof Error
      ? e.message
      : "Erreur inconnue"

/**
 * Échec d'une opération VPS. Les pannes de connexion Proxmox sont déjà
 * signalées par le client (une seule alerte) : pas de doublon ici.
 */
function reportFailure(
  category: "vps" | "provisioning" | "renewals",
  title: string,
  action: string,
  e: unknown,
  meta: Record<string, unknown> = {},
  corr?: string
) {
  if (isConnectivityError(e)) return
  void logError({
    category,
    title,
    service: "VPS client",
    action,
    result: "failure",
    message: errorText(e),
    correlationId: corr,
    meta,
    dedupeKey: `${action}:${String(meta.vps ?? "")}`,
  })
}

const createSchema = z.object({
  planId: z.string().min(1, "Choisis une offre"),
  name: z.string().trim().min(2, "Nom trop court").max(60, "Nom trop long"),
  password: z
    .string()
    .min(8, "Mot de passe root : 8 caractères minimum")
    .max(128, "Mot de passe trop long"),
  networkMode: z.enum(["dhcp", "static"]).default("dhcp"),
  networkId: z.string().max(64).optional(),
  ipAddressId: z.string().max(64).optional(),
})

export async function createServer(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser()

  const parsed = createSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const { planId, name, password } = parsed.data

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.id, planId), eq(schema.plans.isActive, true)))
  if (!plan) return { error: "Offre introuvable" }

  const [{ owned }] = await db
    .select({ owned: count() })
    .from(schema.servers)
    .where(eq(schema.servers.userId, user.id))
  if (user.role !== "admin" && owned >= user.serverLimit) {
    return { error: `Limite atteinte (${user.serverLimit} VPS).` }
  }

  const localId = crypto.randomUUID()
  // Mode factures : service actif pendant le délai de paiement de la commande.
  const invoicing = await invoicingFor(plan)

  // Crédits (si la facturation est activée) : débit avant la création,
  // remboursé si elle échoue.
  const charge = await chargeForPlan({
    actor: user,
    payerId: user.id,
    plan,
    kind: "purchase",
    reference: localId,
    key: `order:${localId}`,
  })
  if (!charge.ok) return { error: charge.error }
  const refund = (reason: string) =>
    refundCharge({
      payerId: user.id,
      amountCents: charge.charged,
      reference: localId,
      key: `order:${localId}`,
      reason,
    })

  // Réseau : validation serveur + réservation atomique de l'IP (statique).
  const net = await resolveNetwork(
    plan,
    {
      mode: parsed.data.networkMode,
      networkId: parsed.data.networkId || null,
      addressId: parsed.data.ipAddressId || null,
    },
    user.email
  )
  if (!net.ok) {
    await refund("Commande annulée : réseau indisponible")
    return { error: net.error }
  }

  const cfg = plan.proxmox
  const corr = newCorrelationId()
  let vmid: number | null = null

  try {
    vmid = await nextVmid()
    const vps = await createVps({
      virt: cfg.virt,
      node: cfg.node,
      storage: cfg.storage,
      bridge: cfg.bridge,
      template: cfg.template,
      cores: cfg.cores,
      memoryMb: plan.memoryMb,
      swapMb: Math.max(plan.swapMb, 0),
      diskGb: Math.max(1, Math.round(plan.diskMb / 1024)),
      hostname: toHostname(name),
      password,
      vmid,
      network: net.spec,
    })

    // Adresses réellement observées. En statique, l'adresse demandée est
    // enregistrée comme configurée ; l'état de synchronisation dit la vérité.
    const seen = await getVpsAddresses(vps.node, vps.virt, vps.vmid, {
      configFallback: false,
    })
    const staticV4 = net.mode === "static" && net.family === "ipv4"
    const staticV6 = net.mode === "static" && net.family === "ipv6"
    const observedMatches =
      net.mode === "static"
        ? (staticV4 ? seen.ipv4 : seen.ipv6) === net.address
        : Boolean(seen.ipv4 || seen.ipv6)

    await db.insert(schema.servers).values({
      id: localId,
      userId: user.id,
      planId: plan.id,
      name,
      vmid: vps.vmid,
      node: vps.node,
      virt: vps.virt,
      os:
        allowedTemplates(plan).find((t) => t.value === cfg.template)?.label ??
        templateLabel(cfg.virt, cfg.template),
      address: staticV4 ? net.address : seen.ipv4,
      ipv6: staticV6 ? net.address : seen.ipv6,
      networkMode: net.mode,
      networkId: net.networkId,
      ipAddressId: net.addressId,
      netSyncState: observedMatches ? "synced" : "pending",
      netUpdatedAt: new Date(),
      expiresAt: invoicing
        ? orderGraceExpiry(invoicing)
        : newExpiry(plan.periodDays),
      lastRenewedAt: new Date(),
    })

    if (net.addressId) {
      await confirmAssignment(net.addressId, localId, "static", user.email)
    }
  } catch (e) {
    // On ne libère la réservation que si plus aucun VPS réel n'en dépend.
    if (net.ok && net.addressId) {
      const alive =
        vmid !== null
          ? await vpsExists(cfg.node, cfg.virt, vmid).catch(() => true)
          : false
      if (!alive) await cancelReservation(net.addressId, user.email)
    }
    // Remboursé seulement si aucun VPS réel n'a été créé.
    const created =
      vmid !== null
        ? await vpsExists(cfg.node, cfg.virt, vmid).catch(() => true)
        : false
    if (!created) await refund("Commande échouée : remboursement")
    reportFailure(
      "provisioning",
      "Échec du provisionnement d'un VPS",
      "création",
      e,
      { vps: localId, offre: plan.name },
      corr
    )
    return { error: errorMessage(e) }
  }

  void logSuccess({
    category: "vps",
    title: "VPS créé",
    service: "VPS client",
    action: "création",
    result: "success",
    correlationId: corr,
    meta: { vps: localId, offre: plan.name, type: cfg.virt },
    dedupeKey: `create:${localId}`,
  })
  await logActivity(user, "VPS créé", {
    type: "server",
    id: localId,
    label: name,
  })
  void emitEvent("service.created", {
    type: "vps",
    serviceId: localId,
    userId: user.id,
    planId: plan.id,
  })
  if (invoicing) {
    await invoiceOrder({
      userId: user.id,
      serviceType: "vps",
      serviceId: localId,
      serviceName: name,
      plan,
      dueAt: orderGraceExpiry(invoicing),
    }).catch((e) =>
      reportFailure(
        "provisioning",
        "Facture de commande non émise",
        "facturation",
        e,
        { vps: localId }
      )
    )
  }
  revalidatePath("/dashboard")
  redirect(`/servers/${localId}`)
}

export async function power(
  serverId: string,
  signal: VpsSignal
): Promise<ActionState> {
  if (!["start", "stop", "restart", "kill"].includes(signal)) {
    return { error: "Signal invalide" }
  }
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }
  if (server.suspended) return { error: "VPS suspendu" }

  const corr = newCorrelationId()
  try {
    await powerServer(server, signal)
  } catch (e) {
    reportFailure(
      "vps",
      "Échec d'une opération d'alimentation",
      signal,
      e,
      { vps: server.id },
      corr
    )
    return { error: errorMessage(e) }
  }
  void logInfo({
    category: "vps",
    title: "Opération d'alimentation exécutée",
    service: "VPS client",
    action: signal,
    result: "success",
    correlationId: corr,
    meta: { vps: server.id },
    dedupeKey: `power:${server.id}:${signal}`,
    dedupeWindowMs: 20_000,
  })

  const labels: Record<VpsSignal, string> = {
    start: "Démarrage",
    stop: "Arrêt",
    restart: "Redémarrage",
    kill: "Arrêt forcé",
  }
  await logActivity(await requireUser(), labels[signal], {
    type: "server",
    id: server.id,
    label: server.name,
  })
}

export async function deleteServer(serverId: string): Promise<ActionState> {
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }

  try {
    await destroyServer(server)
  } catch (e) {
    reportFailure("vps", "Échec de suppression d'un VPS", "suppression", e, {
      vps: server.id,
    })
    return { error: errorMessage(e) }
  }
  void logWarning({
    category: "vps",
    title: "VPS supprimé",
    service: "VPS client",
    action: "suppression",
    result: "success",
    meta: { vps: server.id },
    dedupeKey: `delete:${server.id}`,
  })

  await db.delete(schema.servers).where(eq(schema.servers.id, server.id))
  await logActivity(await requireUser(), "VPS supprimé", {
    type: "server",
    id: server.id,
    label: server.name,
  })
  revalidatePath("/dashboard")
  redirect("/dashboard")
}

const resetSchema = z.object({
  serverId: z.string().min(1),
  template: z.string().min(1, "Choisis un système"),
  password: z
    .string()
    .min(8, "Mot de passe root : 8 caractères minimum")
    .max(128, "Mot de passe trop long"),
  confirm: z.literal("on", { error: "Confirme la suppression des données" }),
})

/**
 * Réinstalle le VPS avec le template choisi (parmi ceux autorisés par l'offre).
 * Le nouveau VPS est créé AVANT de supprimer l'ancien : en cas d'échec de la
 * création, l'ancien reste intact.
 */
export async function resetServer(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const { serverId, template, password } = parsed.data

  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }
  if (server.suspended) return { error: "VPS suspendu" }
  if (!server.planId) {
    return {
      error: "L'offre de ce VPS n'existe plus : réinstallation impossible.",
    }
  }

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, server.planId))
  if (!plan) return { error: "Offre introuvable" }

  const choice = allowedTemplates(plan).find((t) => t.value === template)
  if (!choice) return { error: "Ce système n'est pas proposé pour cette offre" }

  const cfg = plan.proxmox
  // La configuration réseau (IP statique, VLAN, DNS) est reconduite.
  const keep = await specForServer(server)

  let created: Awaited<ReturnType<typeof createVps>>
  try {
    created = await createVps({
      virt: cfg.virt,
      node: cfg.node,
      storage: cfg.storage,
      bridge: cfg.bridge,
      template: choice.value,
      cores: cfg.cores,
      memoryMb: plan.memoryMb,
      swapMb: Math.max(plan.swapMb, 0),
      diskGb: Math.max(1, Math.round(plan.diskMb / 1024)),
      hostname: toHostname(server.name),
      password,
      network: keep?.spec,
    })
  } catch (e) {
    reportFailure(
      "provisioning",
      "Échec de réinstallation d'un VPS",
      "réinstallation",
      e,
      { vps: server.id }
    )
    return {
      error: `Réinstallation annulée, ton VPS est intact. ${errorMessage(e)}`,
    }
  }

  // Le nouveau VPS prend la place de l'ancien dans la base.
  const old = { ...server }
  await db
    .update(schema.servers)
    .set({
      vmid: created.vmid,
      node: created.node,
      virt: created.virt,
      os: choice.label,
      address: keep?.family === "ipv4" ? keep.address : null,
      ipv6: keep?.family === "ipv6" ? keep.address : null,
      netSyncState: keep ? "pending" : null,
      netUpdatedAt: new Date(),
      sshHostKey: null,
    })
    .where(eq(schema.servers.id, server.id))

  try {
    await destroyServer(old)
  } catch (e) {
    revalidatePath(`/servers/${server.id}`)
    return {
      error: `Réinstallé, mais l'ancien VPS (VMID ${old.vmid}) n'a pas pu être supprimé : ${errorMessage(e)}`,
    }
  }

  void logSuccess({
    category: "provisioning",
    title: "VPS réinstallé",
    service: "VPS client",
    action: "réinstallation",
    result: "success",
    meta: { vps: server.id },
    dedupeKey: `reset:${server.id}`,
  })
  await logActivity(await requireUser(), `VPS réinstallé (${choice.label})`, {
    type: "server",
    id: server.id,
    label: server.name,
  })
  revalidatePath(`/servers/${server.id}`)
  revalidatePath("/dashboard")
  redirect(`/servers/${server.id}`)
}

/**
 * Renouvelle le VPS d'une période. Si le VPS avait été suspendu pour échéance
 * dépassée, la suspension est levée (il reste à le démarrer).
 */
export async function renewServer(serverId: string): Promise<ActionState> {
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }
  if (!server.expiresAt) return { error: "Ce VPS n'a pas d'échéance" }
  if (server.cancelAtPeriodEnd) {
    return {
      error: "Annulation programmée : conserve le service pour le renouveler.",
    }
  }
  if (server.suspended && server.suspendReason !== "expired") {
    return { error: "VPS suspendu par un administrateur" }
  }

  const now = new Date()
  const [plan] = server.planId
    ? await db
        .select({
          periodDays: schema.plans.periodDays,
          name: schema.plans.name,
          priceCents: schema.plans.priceCents,
        })
        .from(schema.plans)
        .where(eq(schema.plans.id, server.planId))
    : []
  const periodDays = plan?.periodDays ?? null
  const periodLabel = periodDays ?? env.RENEW_PERIOD_DAYS

  // Un seul renouvellement par période.
  const nextAllowed = nextRenewalAt(server.lastRenewedAt, periodDays)
  if (nextAllowed && nextAllowed > now) {
    return {
      error: `Un seul renouvellement par ${periodLabel} jours : prochain possible le ${nextAllowed.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}.`,
    }
  }

  const cap = maxExpiry(periodDays, now)
  if (server.expiresAt >= cap) {
    return {
      error: `Déjà renouvelé au maximum (jusqu'au ${cap.toLocaleDateString("fr-FR")}).`,
    }
  }

  const actor = await requireUser()

  // Mode factures : le renouvellement passe par une facture (réglée
  // automatiquement par le solde si possible, sinon page de paiement).
  if (plan && (await invoicingFor(plan))) {
    const inv = await renewalInvoice({
      userId: server.userId,
      serviceType: "vps",
      serviceId: server.id,
      serviceName: server.name,
      plan,
      expiresAt: server.expiresAt,
    })
    if (!inv)
      return { error: "Facture de renouvellement impossible à émettre." }
    if (inv.status === "unpaid" && !(await tryAutoPay(inv))) {
      redirect(`/invoices/${inv.id}`)
    }
    revalidatePath(`/servers/${server.id}`)
    return undefined
  }

  // Crédits (si la facturation est activée) : payés par le propriétaire.
  const renewKey = `renew:${server.id}:${server.lastRenewedAt?.getTime() ?? 0}`
  const charge = plan
    ? await chargeForPlan({
        actor,
        payerId: server.userId,
        plan,
        kind: "renewal",
        reference: server.id,
        key: renewKey,
      })
    : ({ ok: true, charged: 0 } as const)
  if (!charge.ok) return { error: charge.error }

  try {
    if (server.suspended && server.suspendReason === "expired") {
      await setSuspended(server, false)
    }
  } catch (e) {
    await refundCharge({
      payerId: server.userId,
      amountCents: charge.charged,
      reference: server.id,
      key: renewKey,
      reason: "Renouvellement échoué : remboursement",
    })
    reportFailure(
      "renewals",
      "Échec de renouvellement d'un VPS",
      "renouvellement",
      e,
      {
        vps: server.id,
      }
    )
    return { error: errorMessage(e) }
  }

  await db
    .update(schema.servers)
    .set({
      expiresAt: extendedExpiry(server.expiresAt, periodDays, now),
      lastRenewedAt: now,
      ...(server.suspendReason === "expired"
        ? { suspended: false, suspendReason: null }
        : {}),
    })
    .where(eq(schema.servers.id, server.id))

  await logActivity(actor, "VPS renouvelé", {
    type: "server",
    id: server.id,
    label: server.name,
  })
  revalidatePath(`/servers/${server.id}`)
  revalidatePath("/dashboard")
  return undefined
}

/** Autorise root en SSH par mot de passe dans un LXC déjà créé. */
export async function repairRootSsh(serverId: string): Promise<ActionState> {
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }
  if (server.virt !== "lxc") return { error: "Réservé aux conteneurs LXC" }
  const res = await enableRootSsh(server.vmid)
  if (!res.ok) return { error: res.detail ?? "Échec" }
  return undefined
}

/** Oublie l'empreinte SSH mémorisée (après réinstallation hors site, par ex.). */
export async function forgetSshHostKey(serverId: string): Promise<ActionState> {
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }
  await db
    .update(schema.servers)
    .set({ sshHostKey: null })
    .where(eq(schema.servers.id, server.id))
  return undefined
}

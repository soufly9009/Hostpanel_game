"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { and, count, eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireAdmin, requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { auditSensitive } from "@/lib/discord/audit"
import {
  errorText,
  logError,
  logSuccess,
  logWarning,
} from "@/lib/discord/logging"
import { env, pterodactylConfigured } from "@/lib/env"
import {
  PteroError,
  createGameServer,
  deleteGameServer,
  getGameAddress,
  isPteroConnectivityError,
  listEggs,
  reinstallGameServer,
  sendCommand,
  sendPower,
  suspendGameServer,
  unsuspendGameServer,
  type PowerSignal,
} from "@/lib/pterodactyl/client"
import { closeConsole } from "@/lib/pterodactyl/console"
import {
  extendedExpiry,
  maxExpiry,
  newExpiry,
  nextRenewalAt,
} from "@/lib/renewals"
import {
  invoiceOrder,
  invoicingFor,
  orderGraceExpiry,
  renewalInvoice,
  tryAutoPay,
} from "@/lib/billing/service"
import { chargeForPlan, refundCharge } from "@/lib/wallet/billing"
import { emitEvent } from "@/lib/webhooks/service"
import { parseCredits } from "@/lib/wallet/format"

import { getAccessibleGame } from "./access"

export type GameState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const message = (e: unknown) => errorText(e)

function refresh(id?: string) {
  revalidatePath("/games")
  if (id) revalidatePath(`/games/${id}`)
  revalidatePath("/admin/games")
}

/* ───────────── Commande ───────────── */

const createSchema = z.object({
  planId: z.string().min(1, "Choisis une offre").max(64),
  name: z
    .string()
    .trim()
    .min(2, "Nom trop court")
    .max(60, "Nom trop long")
    .regex(/^[\p{L}\p{N} _.'-]+$/u, "Caractères non autorisés dans le nom"),
})

export async function createGameAction(
  _prev: GameState,
  formData: FormData
): Promise<GameState> {
  const user = await requireUser()
  if (!pterodactylConfigured) {
    return { error: "Les serveurs de jeu ne sont pas encore disponibles." }
  }
  const parsed = createSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const [plan] = await db
    .select()
    .from(schema.gamePlans)
    .where(
      and(
        eq(schema.gamePlans.id, parsed.data.planId),
        eq(schema.gamePlans.isActive, true)
      )
    )
  if (!plan) return { error: "Offre introuvable" }

  if (user.role !== "admin") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.gameServers)
      .where(eq(schema.gameServers.userId, user.id))
    if (n >= env.PTERODACTYL_SERVER_LIMIT) {
      return {
        error: `Limite atteinte (${env.PTERODACTYL_SERVER_LIMIT} serveur(s) de jeu).`,
      }
    }
  }

  const localId = crypto.randomUUID()
  const invoicing = await invoicingFor(plan)
  const charge = await chargeForPlan({
    actor: user,
    payerId: user.id,
    plan,
    kind: "purchase",
    reference: localId,
    key: `game-order:${localId}`,
  })
  if (!charge.ok) return { error: charge.error }

  let pteroId: number | null = null
  try {
    const srv = await createGameServer({
      name: parsed.data.name,
      externalId: localId,
      plan,
    })
    pteroId = srv.id
    const address = await getGameAddress(srv.id).catch(() => null)
    await db.insert(schema.gameServers).values({
      id: localId,
      userId: user.id,
      planId: plan.id,
      name: parsed.data.name,
      pteroId: srv.id,
      pteroIdentifier: srv.identifier,
      pteroUuid: srv.uuid,
      address,
      expiresAt: invoicing
        ? orderGraceExpiry(invoicing)
        : newExpiry(plan.periodDays),
      lastRenewedAt: new Date(),
    })
  } catch (e) {
    // Serveur créé mais non enregistré : on ne laisse pas d'orphelin.
    if (pteroId !== null) await deleteGameServer(pteroId).catch(() => undefined)
    await refundCharge({
      payerId: user.id,
      amountCents: charge.charged,
      reference: localId,
      key: `game-order:${localId}`,
      reason: "Commande de serveur de jeu échouée : remboursement",
    })
    if (!isPteroConnectivityError(e)) {
      void logError({
        category: "provisioning",
        title: "Échec de création d'un serveur de jeu",
        service: "Serveur de jeu",
        action: "création",
        result: "failure",
        message: message(e),
        meta: { offre: plan.name },
        dedupeKey: `game-create:${plan.id}:${message(e).slice(0, 60)}`,
      })
    }
    return { error: `Création impossible : ${message(e)}` }
  }

  void logSuccess({
    category: "pterodactyl",
    title: "Serveur de jeu créé",
    service: "Serveur de jeu",
    action: "création",
    result: "success",
    meta: { serveur: localId, offre: plan.name },
    dedupeKey: `game-created:${localId}`,
  })
  await logActivity(user, "Serveur de jeu créé", {
    type: "game",
    id: localId,
    label: parsed.data.name,
  })
  void emitEvent("service.created", {
    type: "game",
    serviceId: localId,
    userId: user.id,
    planId: plan.id,
  })
  if (invoicing) {
    await invoiceOrder({
      userId: user.id,
      serviceType: "game",
      serviceId: localId,
      serviceName: parsed.data.name,
      plan,
      dueAt: orderGraceExpiry(invoicing),
    }).catch((e) =>
      logError({
        category: "billing",
        title: "Facture de commande non émise",
        service: "Facturation",
        action: "facturation",
        result: "failure",
        message: message(e),
        meta: { serveur: localId },
        dedupeKey: `game-invoice:${localId}`,
      })
    )
  }
  refresh()
  redirect(`/games/${localId}`)
}

/* ───────────── Pilotage ───────────── */

async function usable(id: string) {
  const access = await getAccessibleGame(id)
  if (!access) return { error: "Serveur introuvable" } as const
  if (access.game.suspended) {
    return {
      error:
        access.game.suspendReason === "expired"
          ? "Serveur suspendu : renouvelle-le pour le réactiver."
          : "Serveur suspendu par un administrateur.",
    } as const
  }
  return access
}

export async function gamePowerAction(
  id: string,
  signal: PowerSignal
): Promise<GameState> {
  if (!["start", "stop", "restart", "kill"].includes(signal)) {
    return { error: "Action inconnue" }
  }
  const access = await usable(id)
  if ("error" in access) return { error: access.error }
  try {
    await sendPower(access.game.pteroIdentifier, signal)
  } catch (e) {
    return { error: message(e) }
  }
  await logActivity(access.user, `Serveur de jeu : ${signal}`, {
    type: "game",
    id,
    label: access.game.name,
  })
  return { ok: true }
}

export async function gameCommandAction(
  id: string,
  command: string
): Promise<GameState> {
  const cmd = String(command ?? "").trim()
  if (!cmd || cmd.length > 500 || /[\r\n\0]/.test(cmd)) {
    return { error: "Commande invalide" }
  }
  const access = await usable(id)
  if ("error" in access) return { error: access.error }
  try {
    await sendCommand(access.game.pteroIdentifier, cmd)
  } catch (e) {
    // 502 : serveur éteint (Wings refuse la commande).
    return {
      error:
        e instanceof PteroError && e.status === 502
          ? "Le serveur doit être démarré pour recevoir une commande."
          : message(e),
    }
  }
  return { ok: true }
}

/** Réinstalle (script d'installation de l'egg) : peut écraser des fichiers. */
export async function reinstallGameAction(id: string): Promise<GameState> {
  const access = await usable(id)
  if ("error" in access) return { error: access.error }
  try {
    await reinstallGameServer(access.game.pteroId)
  } catch (e) {
    return { error: message(e) }
  }
  await logActivity(access.user, "Serveur de jeu réinstallé", {
    type: "game",
    id,
    label: access.game.name,
  })
  return { ok: true, notice: "Réinstallation lancée." }
}

/* ───────────── Renouvellement ───────────── */

export async function renewGameAction(id: string): Promise<GameState> {
  const access = await getAccessibleGame(id)
  if (!access) return { error: "Serveur introuvable" }
  const { game, user } = access
  if (!game.expiresAt) return { error: "Ce serveur n'a pas d'échéance" }
  if (game.cancelAtPeriodEnd) {
    return {
      error: "Annulation programmée : conserve le service pour le renouveler.",
    }
  }
  if (game.suspended && game.suspendReason !== "expired") {
    return { error: "Serveur suspendu par un administrateur" }
  }

  const [plan] = game.planId
    ? await db
        .select()
        .from(schema.gamePlans)
        .where(eq(schema.gamePlans.id, game.planId))
    : []
  const periodDays = plan?.periodDays ?? null
  const now = new Date()

  const nextAllowed = nextRenewalAt(game.lastRenewedAt, periodDays)
  if (nextAllowed && nextAllowed > now) {
    return {
      error: `Un seul renouvellement par période : prochain possible le ${nextAllowed.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}.`,
    }
  }
  const cap = maxExpiry(periodDays, now)
  if (game.expiresAt >= cap) {
    return {
      error: `Déjà renouvelé au maximum (jusqu'au ${cap.toLocaleDateString("fr-FR")}).`,
    }
  }

  if (plan && (await invoicingFor(plan))) {
    const inv = await renewalInvoice({
      userId: game.userId,
      serviceType: "game",
      serviceId: game.id,
      serviceName: game.name,
      plan,
      expiresAt: game.expiresAt,
    })
    if (!inv)
      return { error: "Facture de renouvellement impossible à émettre." }
    if (inv.status === "unpaid" && !(await tryAutoPay(inv))) {
      redirect(`/invoices/${inv.id}`)
    }
    refresh(game.id)
    return undefined
  }

  const key = `game-renew:${game.id}:${game.lastRenewedAt?.getTime() ?? 0}`
  const charge = plan
    ? await chargeForPlan({
        actor: user,
        payerId: game.userId,
        plan,
        kind: "renewal",
        reference: game.id,
        key,
      })
    : ({ ok: true, charged: 0 } as const)
  if (!charge.ok) return { error: charge.error }

  if (game.suspended && game.suspendReason === "expired") {
    try {
      await unsuspendGameServer(game.pteroId)
    } catch (e) {
      await refundCharge({
        payerId: game.userId,
        amountCents: charge.charged,
        reference: game.id,
        key,
        reason: "Renouvellement échoué : remboursement",
      })
      return { error: message(e) }
    }
  }

  await db
    .update(schema.gameServers)
    .set({
      expiresAt: extendedExpiry(game.expiresAt, periodDays, now),
      lastRenewedAt: now,
      ...(game.suspendReason === "expired"
        ? { suspended: false, suspendReason: null }
        : {}),
    })
    .where(eq(schema.gameServers.id, game.id))

  await logActivity(user, "Serveur de jeu renouvelé", {
    type: "game",
    id: game.id,
    label: game.name,
  })
  refresh(game.id)
  return undefined
}

/* ───────────── Suppression ───────────── */

export async function deleteGameAction(id: string): Promise<GameState> {
  const access = await getAccessibleGame(id)
  if (!access) return { error: "Serveur introuvable" }
  const { game, user } = access
  try {
    await deleteGameServer(game.pteroId)
  } catch (e) {
    return { error: message(e) }
  }
  closeConsole(game.id)
  await db.delete(schema.gameServers).where(eq(schema.gameServers.id, game.id))
  await logActivity(user, "Serveur de jeu supprimé", {
    type: "game",
    id: game.id,
    label: game.name,
  })
  void logWarning({
    category: "pterodactyl",
    title: "Serveur de jeu supprimé",
    service: "Serveur de jeu",
    action: "suppression",
    result: "success",
    meta: { serveur: game.id },
    dedupeKey: `game-del:${game.id}`,
  })
  refresh()
  redirect(
    user.role === "admin" && user.id !== game.userId ? "/admin/games" : "/games"
  )
}

/* ───────────── Administration ───────────── */

export async function setGameSuspendedAction(
  id: string,
  suspended: boolean
): Promise<GameState> {
  const admin = await requireAdmin()
  const [game] = await db
    .select()
    .from(schema.gameServers)
    .where(eq(schema.gameServers.id, z.string().max(64).parse(id)))
  if (!game) return { error: "Serveur introuvable" }
  try {
    if (suspended) await suspendGameServer(game.pteroId)
    else await unsuspendGameServer(game.pteroId)
  } catch (e) {
    return { error: message(e) }
  }
  if (suspended) closeConsole(game.id)
  await db
    .update(schema.gameServers)
    .set({ suspended, suspendReason: suspended ? "admin" : null })
    .where(eq(schema.gameServers.id, game.id))
  await logActivity(
    admin,
    suspended ? "Serveur de jeu suspendu" : "Serveur de jeu réactivé",
    { type: "game", id: game.id, label: game.name }
  )
  refresh(game.id)
  return { ok: true }
}

const planSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(80),
  description: z.string().trim().max(300).optional(),
  egg: z.string().regex(/^\d+:\d+$/, "Choisis un egg"),
  locationId: z.coerce.number().int().min(1, "Choisis un emplacement"),
  memoryMb: z.coerce.number().int().min(128).max(1_048_576),
  diskMb: z.coerce.number().int().min(256).max(10_485_760),
  cpuPercent: z.coerce.number().int().min(0).max(10_000),
  databases: z.coerce.number().int().min(0).max(50),
  backups: z.coerce.number().int().min(0).max(100),
  periodDays: z.coerce.number().int().min(0).max(365),
})

/** Variables imposées : une par ligne, CLE=valeur. */
function parseEnvironment(raw: string) {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const m = /^([A-Z0-9_]{1,64})=(.*)$/.exec(t)
    if (!m)
      return { error: `Ligne invalide : « ${t.slice(0, 40)} » (CLE=valeur)` }
    out[m[1]] = m[2].slice(0, 500)
  }
  return { env: out }
}

async function planValues(formData: FormData) {
  const parsed = planSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const price = parseCredits(formData.get("price") || "0")
  if (price === null || price < 0) return { error: "Prix invalide" }
  const envVars = parseEnvironment(String(formData.get("environment") ?? ""))
  if ("error" in envVars) return { error: envVars.error }

  const [nestId, eggId] = parsed.data.egg.split(":").map(Number)
  const egg = (await listEggs()).find(
    (e) => e.id === eggId && e.nest === nestId
  )
  if (!egg) return { error: "Egg introuvable sur Pterodactyl" }

  return {
    values: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      priceCents: price,
      nestId,
      eggId,
      eggName: egg.name,
      locationId: parsed.data.locationId,
      memoryMb: parsed.data.memoryMb,
      diskMb: parsed.data.diskMb,
      cpuPercent: parsed.data.cpuPercent,
      databases: parsed.data.databases,
      backups: parsed.data.backups,
      environment: envVars.env,
      periodDays: parsed.data.periodDays || null,
      isActive: formData.get("isActive") !== null,
    },
  }
}

export async function saveGamePlanAction(
  _prev: GameState,
  formData: FormData
): Promise<GameState> {
  const admin = await requireAdmin()
  let v: Awaited<ReturnType<typeof planValues>>
  try {
    v = await planValues(formData)
  } catch (e) {
    return { error: message(e) }
  }
  if (!v.values) return { error: v.error }

  const id = String(formData.get("id") ?? "")
  if (id) {
    const res = await db
      .update(schema.gamePlans)
      .set(v.values)
      .where(eq(schema.gamePlans.id, id))
    if (res.rowsAffected !== 1) return { error: "Offre introuvable" }
  } else {
    await db.insert(schema.gamePlans).values(v.values)
  }
  await logActivity(
    admin,
    id ? "Offre de jeu modifiée" : "Offre de jeu créée",
    {
      type: "plan",
      label: v.values.name,
    }
  )
  auditSensitive(admin, id ? "Offre de jeu modifiée" : "Offre de jeu créée", {
    offre: v.values.name,
  })
  refresh()
  return { ok: true, notice: id ? "Offre enregistrée." : "Offre créée." }
}

export async function deleteGamePlanAction(id: string): Promise<GameState> {
  const admin = await requireAdmin()
  const [plan] = await db
    .delete(schema.gamePlans)
    .where(eq(schema.gamePlans.id, z.string().max(64).parse(id)))
    .returning()
  if (!plan) return { error: "Offre introuvable" }
  await logActivity(admin, "Offre de jeu supprimée", {
    type: "plan",
    label: plan.name,
  })
  refresh()
  return { ok: true }
}

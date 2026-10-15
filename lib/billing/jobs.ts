import "server-only"

import { and, eq, gt, isNotNull, lte } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { errorText } from "@/lib/discord/logging"
import { claim } from "@/lib/jobs"
import { links, queueUserEmail } from "@/lib/mail/service"
import { notify } from "@/lib/notifications"

import { formatMoney } from "./money"
import { renewalInvoice, tryAutoPay, type ServiceType } from "./service"
import { getBillingSettings } from "./settings"

const DAY = 86_400_000

/**
 * Tâche horaire de facturation (réservée en base, une instance à la fois) :
 * 1. factures de renouvellement N jours avant l'échéance des services ;
 * 2. règlement automatique par le solde de crédits ;
 * 3. rappel avant échéance puis relance en retard (une fois chacun).
 * La suspension d'un service impayé reste celle de l'échéance (renewals.ts).
 */
export async function runBillingJobs() {
  const s = await getBillingSettings()
  if (s.mode !== "invoices") return null
  if (!(await claim("billing", 60 * 60_000 - 60_000))) return null

  const now = new Date()
  const horizon = new Date(now.getTime() + s.renewalDaysBefore * DAY)
  const result = {
    invoices: 0,
    autoPaid: 0,
    reminders: 0,
    errors: [] as string[],
  }

  // 1. Renouvellements à facturer.
  const vps = await db
    .select({ svc: schema.servers, plan: schema.plans })
    .from(schema.servers)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.servers.planId))
    .where(
      and(
        isNotNull(schema.servers.expiresAt),
        lte(schema.servers.expiresAt, horizon)
      )
    )
  const games = await db
    .select({ svc: schema.gameServers, plan: schema.gamePlans })
    .from(schema.gameServers)
    .innerJoin(
      schema.gamePlans,
      eq(schema.gamePlans.id, schema.gameServers.planId)
    )
    .where(
      and(
        isNotNull(schema.gameServers.expiresAt),
        lte(schema.gameServers.expiresAt, horizon)
      )
    )
  const due: {
    type: ServiceType
    svc: (typeof vps)[number]["svc"] | (typeof games)[number]["svc"]
    plan: { name: string; priceCents: number; periodDays: number | null }
  }[] = [
    ...vps.map((r) => ({ type: "vps" as const, svc: r.svc, plan: r.plan })),
    ...games.map((r) => ({ type: "game" as const, svc: r.svc, plan: r.plan })),
  ]
  for (const d of due) {
    // Suspendu par un administrateur ou offre gratuite : pas de facture.
    if (
      d.svc.suspendReason === "admin" ||
      d.svc.cancelAtPeriodEnd ||
      d.plan.priceCents <= 0
    ) {
      continue
    }
    try {
      const before = await renewalInvoice({
        userId: d.svc.userId,
        serviceType: d.type,
        serviceId: d.svc.id,
        serviceName: d.svc.name,
        plan: d.plan,
        expiresAt: d.svc.expiresAt as Date,
      })
      if (before && before.createdAt.getTime() >= now.getTime() - 60_000) {
        result.invoices++
      }
    } catch (e) {
      result.errors.push(`${d.svc.name} : ${errorText(e)}`)
    }
  }

  // 2 et 3. Factures impayées.
  const unpaid = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "unpaid"),
        eq(schema.invoices.type, "invoice"),
        gt(schema.invoices.totalCents, 0)
      )
    )
  for (const inv of unpaid) {
    try {
      if (await tryAutoPay(inv)) {
        result.autoPaid++
        continue
      }
      if (!inv.userId) continue
      const vars = {
        number: inv.number,
        total: formatMoney(inv.totalCents, inv.currency),
        dueDate: inv.dueAt.toLocaleDateString("fr-FR"),
        invoiceUrl: links.invoice(inv.id),
      }
      const overdue = inv.dueAt <= now
      const soon =
        inv.dueAt.getTime() - now.getTime() <= s.reminderDaysBefore * DAY
      const step = overdue ? 2 : soon ? 1 : 0
      if (step > inv.remindersSent) {
        const res = await db
          .update(schema.invoices)
          .set({ remindersSent: step })
          .where(
            and(
              eq(schema.invoices.id, inv.id),
              eq(schema.invoices.remindersSent, inv.remindersSent)
            )
          )
        if (res.rowsAffected !== 1) continue
        await queueUserEmail(
          inv.userId,
          overdue ? "invoice_overdue" : "invoice_reminder",
          vars
        )
        await notify({
          userId: inv.userId,
          dedupeKey: `invoice-reminder:${inv.id}:${step}`,
          title: overdue
            ? `Facture ${inv.number} en retard`
            : `Facture ${inv.number} à régler avant le ${vars.dueDate}`,
          href: `/invoices/${inv.id}`,
          level: overdue ? "error" : "warning",
        })
        result.reminders++
      }
    } catch (e) {
      result.errors.push(`${inv.number} : ${errorText(e)}`)
    }
  }

  await db
    .update(schema.jobRuns)
    .set({ lastResult: result })
    .where(eq(schema.jobRuns.name, "billing"))
  return result
}

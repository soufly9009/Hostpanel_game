import {
  errorText,
  flushPending,
  logError,
  purgeOldEvents,
} from "@/lib/discord/logging"
import {
  runAnnouncementReminders,
  runAutoSnapshots,
  runNotificationChecks,
} from "@/lib/jobs"
import { resumeAppQueues } from "@/lib/apps/service"
import { runBillingJobs } from "@/lib/billing/jobs"
import { flushEmails, purgeOldEmails } from "@/lib/mail/service"
import { purgeLoginEvents } from "@/lib/security/mfa"
import { flushWebhooks, purgeOldDeliveries } from "@/lib/webhooks/service"
import { runRenewalCheck } from "@/lib/renewals"

/**
 * Planificateur interne : vérifie toutes les heures si les tâches sont dues.
 * Chaque tâche réserve atomiquement son exécution en base (job_runs), donc un
 * redémarrage ou plusieurs instances ne la lancent pas en double.
 *
 * Une minute sur deux, la file de notifications Discord est aussi traitée :
 * les événements en attente (échec réseau, limite de débit, redémarrage)
 * sont ainsi réessayés sans attendre le prochain tick horaire.
 */

const g = globalThis as unknown as { __renewalScheduler?: boolean }

/** Une tâche en échec produit un seul événement (dédupliqué), jamais fatal. */
function reportJobFailure(job: string, e: unknown) {
  console.error(`[${job}] échec`, e instanceof Error ? e.message : e)
  void logError({
    category: "scheduler",
    title: "Échec d'une tâche planifiée",
    service: "Planificateur",
    action: job,
    result: "failure",
    message: errorText(e),
    dedupeKey: `job:${job}`,
  })
}

export function startScheduler() {
  if (g.__renewalScheduler) return
  g.__renewalScheduler = true

  const tick = async () => {
    try {
      const r = await runRenewalCheck()
      if (r) {
        console.log(
          `[renewals] ${r.checked} VPS vérifiés · ${r.suspended} suspendus · ${r.deleted} supprimés · ${r.expiringSoon} à renouveler bientôt` +
            (r.errors.length ? ` · ${r.errors.length} erreur(s)` : "")
        )
        for (const err of r.errors) console.error(`[renewals] ${err}`)
      }
    } catch (e) {
      reportJobFailure("renewals", e)
    }

    try {
      const n = await runNotificationChecks()
      if (n) console.log(`[notifications] ${n.created} créée(s)`)
    } catch (e) {
      reportJobFailure("notifications", e)
    }

    try {
      const a = await runAnnouncementReminders()
      if (a) {
        console.log(
          `[announcements] ${a.maintenance} rappel(s) maintenance · ${a.migrations} rappel(s) migration`
        )
      }
    } catch (e) {
      reportJobFailure("announcements", e)
    }

    try {
      const s = await runAutoSnapshots()
      if (s) {
        console.log(
          `[snapshots] ${s.checked} VPS · ${s.created} créé(s) · ${s.pruned} purgé(s)` +
            (s.errors.length ? ` · ${s.errors.length} erreur(s)` : "")
        )
      }
    } catch (e) {
      reportJobFailure("snapshots", e)
    }

    try {
      const b = await runBillingJobs()
      if (b) {
        console.log(
          `[billing] ${b.invoices} facture(s) · ${b.autoPaid} réglée(s) automatiquement · ${b.reminders} rappel(s)` +
            (b.errors.length ? ` · ${b.errors.length} erreur(s)` : "")
        )
      }
    } catch (e) {
      reportJobFailure("billing", e)
    }

    // Rétention locale des événements et du journal d'e-mails (90 jours).
    await purgeOldEvents().catch(() => {})
    await purgeOldEmails().catch(() => {})
    await purgeOldDeliveries().catch(() => {})
    await purgeLoginEvents().catch(() => {})
  }

  const flush = () => {
    // Jamais d'exception ici : la supervision ne doit pas faire tomber le panel.
    void flushPending(10).catch(() => {})
    void flushEmails(20).catch(() => {})
    void flushWebhooks(20).catch(() => {})
    void resumeAppQueues().catch(() => {})
  }

  // Petit délai au démarrage, puis contrôle horaire.
  setTimeout(tick, 15_000).unref?.()
  setInterval(tick, 60 * 60 * 1000).unref?.()

  // Reprise de la file Discord au démarrage, puis toutes les minutes.
  setTimeout(flush, 5_000).unref?.()
  setInterval(flush, 60 * 1000).unref?.()
}

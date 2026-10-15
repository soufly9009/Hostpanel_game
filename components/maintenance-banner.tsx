import { AlertTriangleIcon, WrenchIcon } from "lucide-react"

import { Countdown } from "@/components/countdown"
import { StatusBadge } from "@/components/kit"
import { getCurrentUser } from "@/lib/auth/session"
import { IMPACT_LABEL, minutesLabel } from "@/lib/maintenance/labels"
import { bannersFor } from "@/lib/maintenance/service"
import { formatInZone } from "@/lib/maintenance/time"
import { announcementBannersFor } from "@/lib/migrations/announcements"

/**
 * Bannières d'information : maintenances annoncées ou en cours qui concernent
 * l'utilisateur, et annonces de migration qui le concernent.
 * Les erreurs de lecture n'empêchent jamais d'afficher la page.
 */
export async function MaintenanceBanners() {
  const user = await getCurrentUser()
  if (!user) return null

  const [maint, migs] = await Promise.all([
    bannersFor(user.id).catch(() => []),
    announcementBannersFor({ id: user.id, role: user.role }).catch(() => []),
  ])
  if (maint.length === 0 && migs.length === 0) return null

  return (
    <div className="flex flex-col gap-3" aria-label="Informations de service">
      {maint.map((m) => {
        const running = m.status === "in_progress"
        return (
          <div
            key={m.id}
            role="status"
            className={`flex gap-3 rounded-xl border p-4 text-sm ${
              m.impact === "full" || m.impact === "partial"
                ? "border-amber-500/50 bg-amber-500/10"
                : "border-primary/40 bg-primary/10"
            }`}
          >
            <WrenchIcon className="mt-0.5 size-4 shrink-0" />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.title}</span>
                <StatusBadge tone={running ? "warning" : "info"}>
                  {running ? "En cours" : "Programmée"}
                </StatusBadge>
                <StatusBadge tone={m.impact === "none" ? "neutral" : "warning"}>
                  {IMPACT_LABEL[m.impact]}
                </StatusBadge>
              </div>
              <p className="text-xs text-muted-foreground">
                {m.type} · {formatInZone(new Date(m.startsAt), m.timezone)} →{" "}
                {formatInZone(new Date(m.endsAt), m.timezone)} ({m.timezone})
                {!running && (
                  <>
                    {" · début "}
                    <Countdown to={m.startsAt} pastLabel="prévu maintenant" />
                  </>
                )}
              </p>
              {m.message && <p>{m.message}</p>}
            </div>
          </div>
        )
      })}

      {migs.map((a) => (
        <div
          key={a.id}
          role="status"
          className="flex gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.title}</span>
              <StatusBadge
                tone={a.status === "in_progress" ? "warning" : "info"}
              >
                {a.status === "in_progress" ? "En cours" : "Programmée"}
              </StatusBadge>
            </div>
            <p>{a.message}</p>
            <p className="text-xs text-muted-foreground">
              {a.status !== "in_progress" && (
                <>
                  Début{" "}
                  <Countdown to={a.scheduledAt} pastLabel="prévu maintenant" />
                  {" · "}
                </>
              )}
              Durée estimée : {minutesLabel(a.estimatedMinutes)}
              {a.nodes ? ` · Nœuds : ${a.nodes}` : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

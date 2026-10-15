"use client"

import { useActionState, useState, useTransition } from "react"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createIncident,
  createMaintenance,
  maintenanceTransition,
  rescheduleMaintenance,
  updateIncident,
} from "@/lib/maintenance/actions"
import {
  IMPACT_LABEL,
  MAINTENANCE_TYPE_LABEL,
  SERVICE_KEYS,
  SERVICE_LABEL,
} from "@/lib/maintenance/labels"
import { TIMEZONES } from "@/lib/maintenance/time"

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function MaintenanceForm({ nodes }: { nodes: string[] }) {
  const [state, action, pending] = useActionState(createMaintenance, undefined)
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Titre">
          <Input name="title" required maxLength={120} />
        </Field>
        <Field label="Type">
          <select name="type" className={selectClass} defaultValue="other">
            {Object.entries(MAINTENANCE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Début" hint="Heure dans le fuseau choisi ci-contre">
          <Input name="startsAt" type="datetime-local" required />
        </Field>
        <Field label="Fin estimée">
          <Input name="endsAt" type="datetime-local" required />
        </Field>
        <Field label="Fuseau horaire" hint="Les dates sont stockées en UTC">
          <select
            name="timezone"
            className={selectClass}
            defaultValue="Europe/Paris"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Niveau d'impact">
          <select name="impact" className={selectClass} defaultValue="none">
            {Object.entries(IMPACT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Nœuds Proxmox concernés"
          hint={
            nodes.length > 0
              ? `Séparés par des virgules (connus : ${nodes.join(", ")}). Vide = tous.`
              : "Séparés par des virgules. Vide = tous."
          }
        >
          <Input name="nodes" placeholder="pve1, pve2" />
        </Field>
        <Field label="Rappel avant le début (minutes)">
          <Input
            name="notifyBeforeMinutes"
            type="number"
            min={0}
            defaultValue={1440}
            required
          />
        </Field>
      </div>

      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 font-medium">Services concernés</legend>
        {SERVICE_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" name="services" value={k} />
            {SERVICE_LABEL[k]}
          </label>
        ))}
      </fieldset>

      <Field label="Description interne">
        <textarea
          name="description"
          rows={3}
          maxLength={4000}
          className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </Field>
      <Field
        label="Message destiné aux clients"
        hint="Seul ce texte est visible des clients (et sur la page publique si publiée)."
      >
        <textarea
          name="customerMessage"
          rows={3}
          maxLength={1000}
          className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPublic" />
        Publier sur la page de statut publique (/status)
      </label>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer le brouillon"}
        </Button>
      </div>
    </form>
  )
}

type Status = "draft" | "scheduled" | "in_progress" | "completed" | "cancelled"

export function MaintenanceActions({
  id,
  status,
  title,
  timezone,
  startsLocal,
  endsLocal,
  overdue,
}: {
  id: string
  status: Status
  title: string
  timezone: string
  /** Valeurs « YYYY-MM-DDTHH:mm » dans le fuseau de l'événement. */
  startsLocal: string
  endsLocal: string
  /** Programmée mais l'heure de début est passée sans démarrage explicite. */
  overdue: boolean
}) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    "cancel" | "start" | "reschedule" | null
  >(null)
  const [s, setS] = useState(startsLocal)
  const [e, setE] = useState(endsLocal)

  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setMsg(null)
      const r = await fn()
      if (r?.error) setMsg(r.error)
      else setDialog(null)
    })

  const t = (a: Parameters<typeof maintenanceTransition>[1]) =>
    run(() => maintenanceTransition(id, a))

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <Button size="xs" disabled={pending} onClick={() => t("schedule")}>
          Programmer et annoncer
        </Button>
      )}
      {status === "scheduled" && (
        <Button
          size="xs"
          variant={overdue ? "default" : "outline"}
          disabled={pending}
          onClick={() => setDialog("start")}
        >
          Marquer comme démarrée
        </Button>
      )}
      {status === "in_progress" && (
        <Button size="xs" disabled={pending} onClick={() => t("complete")}>
          Marquer comme terminée
        </Button>
      )}
      {(status === "draft" || status === "scheduled") && (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => setDialog("reschedule")}
        >
          Replanifier
        </Button>
      )}
      {(status === "draft" ||
        status === "scheduled" ||
        status === "in_progress") && (
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() => setDialog("cancel")}
        >
          Annuler
        </Button>
      )}
      {msg && (
        <span role="alert" className="basis-full text-xs text-destructive">
          {msg}
        </span>
      )}

      <ConfirmDialog
        open={dialog === "start"}
        title="Marquer la maintenance comme démarrée ?"
        description="Cela met à jour le statut et notifie les clients concernés. Aucune opération système n'est lancée par le panel : tu réalises la maintenance toi-même."
        confirmLabel="Marquer comme démarrée"
        pending={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => t("start")}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        title={`Annuler « ${title} » ?`}
        description="Les clients déjà informés recevront une notification d'annulation."
        confirmLabel="Annuler la maintenance"
        destructive
        pending={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => t("cancel")}
      />
      <ConfirmDialog
        open={dialog === "reschedule"}
        title="Replanifier"
        description={
          <div className="flex flex-col gap-3">
            <p>
              Dates dans le fuseau {timezone}. Les clients seront notifiés du
              changement si la maintenance est déjà annoncée.
            </p>
            <Input
              type="datetime-local"
              value={s}
              onChange={(ev) => setS(ev.target.value)}
              aria-label="Nouveau début"
            />
            <Input
              type="datetime-local"
              value={e}
              onChange={(ev) => setE(ev.target.value)}
              aria-label="Nouvelle fin"
            />
          </div>
        }
        confirmLabel="Replanifier"
        pending={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => run(() => rescheduleMaintenance(id, s, e))}
      />
    </div>
  )
}

export function IncidentForm() {
  const [state, action, pending] = useActionState(createIncident, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Titre">
          <Input name="title" required maxLength={120} />
        </Field>
        <Field label="Impact">
          <select name="impact" className={selectClass} defaultValue="degraded">
            <option value="degraded">Dégradation</option>
            <option value="partial">Indisponibilité partielle</option>
            <option value="full">Indisponibilité complète</option>
          </select>
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 font-medium">Composants touchés</legend>
        {SERVICE_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" name="components" value={k} />
            {SERVICE_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <Field label="Message">
        <Input name="message" maxLength={1000} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPublic" />
        Publier sur la page de statut publique
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "…" : "Ouvrir l'incident"}
        </Button>
      </div>
    </form>
  )
}

export function IncidentStatusSelect({
  id,
  status,
}: {
  id: string
  status: "investigating" | "identified" | "monitoring" | "resolved"
}) {
  const [pending, start] = useTransition()
  return (
    <select
      aria-label="Statut de l'incident"
      defaultValue={status}
      disabled={pending}
      className={`${selectClass} w-48`}
      onChange={(e) =>
        start(async () => {
          await updateIncident(
            id,
            e.target.value as Parameters<typeof updateIncident>[1]
          )
        })
      }
    >
      <option value="investigating">Investigation</option>
      <option value="identified">Cause identifiée</option>
      <option value="monitoring">Surveillance</option>
      <option value="resolved">Résolu</option>
    </select>
  )
}

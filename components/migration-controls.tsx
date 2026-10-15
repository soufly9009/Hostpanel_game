"use client"

import { useActionState, useState, useTransition } from "react"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  announcementTransition,
  createAnnouncement,
  deployMigrations,
  rescheduleAnnouncementAction,
} from "@/lib/migrations/actions"

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

export function AnnouncementForm({
  servers,
  nodes,
}: {
  servers: { id: string; label: string }[]
  nodes: string[]
}) {
  const [state, action, pending] = useActionState(createAnnouncement, undefined)
  const [kind, setKind] = useState<"database" | "vps">("database")

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type d'annonce">
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "database" | "vps")}
            className={selectClass}
          >
            <option value="database">Migration de base de données</option>
            <option value="vps">Migration de VPS entre nœuds</option>
          </select>
        </Field>
        <Field label="Titre">
          <Input name="title" required maxLength={120} />
        </Field>
        <Field label="Date et heure prévues" hint="Fuseau Europe/Paris">
          <Input name="scheduledAt" type="datetime-local" required />
        </Field>
        <Field label="Durée estimée (minutes)">
          <Input
            name="estimatedMinutes"
            type="number"
            min={1}
            defaultValue={15}
            required
          />
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
        <Field label="Impact attendu">
          <Input
            name="impact"
            placeholder="Interruption brève du panel"
            maxLength={300}
          />
        </Field>
        {kind === "database" && (
          <div className="sm:col-span-2">
            <Field
              label="Services concernés"
              hint="Séparés par des virgules, affichés tels quels."
            >
              <Input name="services" placeholder="Panel, API, planificateur" />
            </Field>
          </div>
        )}
        {kind === "vps" && (
          <>
            <Field label="Nœud d'origine">
              <Input name="sourceNode" list="mig-nodes" required />
            </Field>
            <Field label="Nœud de destination">
              <Input name="targetNode" list="mig-nodes" required />
            </Field>
            <datalist id="mig-nodes">
              {nodes.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <div className="sm:col-span-2">
              <Field label="Motif">
                <Input name="reason" maxLength={300} />
              </Field>
            </div>
          </>
        )}
      </div>

      {kind === "vps" && (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">VPS concernés</legend>
          {servers.length === 0 ? (
            <p className="text-muted-foreground">Aucun VPS.</p>
          ) : (
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {servers.map((s) => (
                <label key={s.id} className="flex items-center gap-2">
                  <input type="checkbox" name="serverIds" value={s.id} />
                  <span className="truncate">{s.label}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPublic" />
        {kind === "database"
          ? "Afficher aussi aux clients (sinon : administrateurs uniquement)"
          : "Rendre publics les nœuds d'origine/destination et le motif pour les clients concernés"}
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

type Status =
  | "draft"
  | "scheduled"
  | "notified"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"

export function AnnouncementActions({
  id,
  status,
  title,
  localDate,
  minutes,
}: {
  id: string
  status: Status
  title: string
  localDate: string
  minutes: number
}) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [dialog, setDialog] = useState<"cancel" | "reschedule" | "fail" | null>(
    null
  )
  const [date, setDate] = useState(localDate)
  const [mins, setMins] = useState(String(minutes))

  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setMsg(null)
      const r = await fn()
      if (r?.error) setMsg(r.error)
      else setDialog(null)
    })
  const t = (a: Parameters<typeof announcementTransition>[1]) =>
    run(() => announcementTransition(id, a))

  const open = status === "scheduled" || status === "notified"

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <Button size="xs" disabled={pending} onClick={() => t("schedule")}>
          Programmer et notifier
        </Button>
      )}
      {open && (
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => t("start")}
        >
          Marquer comme démarrée
        </Button>
      )}
      {status === "in_progress" && (
        <>
          <Button size="xs" disabled={pending} onClick={() => t("complete")}>
            Marquer comme terminée
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => setDialog("fail")}
          >
            Marquer comme échouée
          </Button>
        </>
      )}
      {(status === "draft" || open) && (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => setDialog("reschedule")}
        >
          Modifier la date
        </Button>
      )}
      {(status === "draft" || open || status === "in_progress") && (
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
        open={dialog === "cancel"}
        title={`Annuler « ${title} » ?`}
        description="Les personnes déjà notifiées recevront un avis d'annulation."
        confirmLabel="Annuler l'annonce"
        destructive
        pending={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => t("cancel")}
      />
      <ConfirmDialog
        open={dialog === "fail"}
        title="Marquer comme échouée ?"
        description="Les personnes concernées seront notifiées de l'échec."
        confirmLabel="Marquer comme échouée"
        destructive
        pending={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => t("fail")}
      />
      <ConfirmDialog
        open={dialog === "reschedule"}
        title="Modifier le planning"
        description={
          <div className="flex flex-col gap-3">
            <p>
              Fuseau Europe/Paris. Si l&apos;annonce est déjà programmée, une
              notification de mise à jour est envoyée.
            </p>
            <Input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Nouvelle date"
            />
            <Input
              type="number"
              min={1}
              value={mins}
              onChange={(e) => setMins(e.target.value)}
              aria-label="Durée estimée (minutes)"
            />
          </div>
        }
        confirmLabel="Enregistrer"
        pending={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          run(() => rescheduleAnnouncementAction(id, date, Number(mins)))
        }
      />
    </div>
  )
}

export function DeployForm({
  tags,
  hasDestructive,
  announcements,
}: {
  tags: string[]
  hasDestructive: boolean
  announcements: { id: string; label: string }[]
}) {
  const [state, action, pending] = useActionState(deployMigrations, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="tags" value={tags.join(",")} />

      {hasDestructive && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="allowDestructive" className="mt-1" />
            <span>
              J&apos;ai relu les opérations destructives ci-dessus et vérifié
              qu&apos;une sauvegarde est exploitable.
            </span>
          </label>
          <Field
            label="Annonce de migration liée"
            hint="Obligatoire pour une migration destructive (programmée ou notifiée)."
          >
            <select
              name="announcementId"
              className={selectClass}
              defaultValue=""
            >
              <option value="">Utiliser la plus récente programmée</option>
              {announcements.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <Field label="Confirmation" hint="Tape APPLIQUER pour confirmer.">
        <Input
          name="confirm"
          autoComplete="off"
          placeholder="APPLIQUER"
          className="max-w-xs"
          required
        />
      </Field>

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
          {pending ? "Application…" : "Appliquer les migrations"}
        </Button>
      </div>
    </form>
  )
}

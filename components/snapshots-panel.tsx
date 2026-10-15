"use client"

import { useCallback, useEffect, useState, useTransition } from "react"

import { ConfirmDialog } from "@/components/kit-client"
import { ErrorState } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createSnapshotAction,
  deleteSnapshotAction,
  rollbackSnapshotAction,
  setAutoSnapshot,
} from "@/lib/servers/snapshot-actions"

type Snap = {
  name: string
  description: string
  createdAt: number | null
  auto: boolean
}
type Data =
  { supported: false; snapshots: [] } | { supported: true; snapshots: Snap[] }

type Pending =
  { kind: "delete"; name: string } | { kind: "rollback"; name: string } | null

export function SnapshotsPanel({
  serverId,
  limit,
  autoEnabled,
  disabled,
}: {
  serverId: string
  /** Snapshots manuels autorisés par l'offre (0 = désactivés). */
  limit: number
  autoEnabled: boolean
  disabled: boolean
}) {
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [auto, setAuto] = useState(autoEnabled)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, startBusy] = useTransition()

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/snapshots`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`)
      setData(json)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erreur")
    }
  }, [serverId])

  useEffect(() => {
    // Chargement initial depuis l'API (système externe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  function run(fn: () => Promise<{ error?: string } | undefined>) {
    setActionError(null)
    startBusy(async () => {
      const res = await fn()
      if (res?.error) setActionError(res.error)
      await load()
      setPending(null)
    })
  }

  if (limit <= 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Les snapshots ne sont pas inclus dans l&apos;offre de ce VPS.
      </p>
    )
  }

  const manualCount =
    data?.supported === true ? data.snapshots.filter((s) => !s.auto).length : 0

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        Un snapshot est stocké sur le même disque que le VPS : il protège
        d&apos;une mauvaise manipulation, pas de la perte du stockage. Ce
        n&apos;est pas une sauvegarde indépendante.
      </p>

      {loadError && (
        <ErrorState title="Snapshots indisponibles" message={loadError} />
      )}
      {data?.supported === false && (
        <ErrorState
          title="Snapshots non pris en charge"
          message="Le stockage de ce VPS ne permet pas les snapshots (ou le droit VM.Snapshot manque)."
        />
      )}

      {data?.supported && (
        <>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              run(async () => {
                const res = await createSnapshotAction(serverId, description)
                if (!res?.error) setDescription("")
                return res
              })
            }}
          >
            <label className="flex flex-col gap-1 text-xs">
              Description (optionnelle)
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={120}
                className="w-72"
                placeholder="Avant mise à jour"
              />
            </label>
            <Button
              type="submit"
              size="sm"
              disabled={busy || disabled || manualCount >= limit}
            >
              {busy ? "En cours…" : "Créer un snapshot"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {manualCount} / {limit} manuels
            </span>
          </form>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={auto}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.checked
                setAuto(next)
                run(async () => {
                  const res = await setAutoSnapshot(serverId, next)
                  if (res?.error) setAuto(!next)
                  return res
                })
              }}
            />
            Snapshot automatique quotidien (les plus récents sont conservés)
          </label>

          {data.snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun snapshot.</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {data.snapshots.map((s) => (
                <li
                  key={s.name}
                  className="flex flex-wrap items-center gap-3 p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono">
                      {s.name}
                      {s.auto && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
                          auto
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.createdAt
                        ? new Date(s.createdAt * 1000).toLocaleString("fr-FR", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "date inconnue"}
                      {s.description ? ` · ${s.description}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || disabled}
                    onClick={() =>
                      setPending({ kind: "rollback", name: s.name })
                    }
                  >
                    Restaurer
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setPending({ kind: "delete", name: s.name })}
                  >
                    Supprimer
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}

      <ConfirmDialog
        open={pending?.kind === "delete"}
        title="Supprimer ce snapshot ?"
        description={
          <>
            Le snapshot <span className="font-mono">{pending?.name}</span> sera
            supprimé définitivement.
          </>
        }
        confirmLabel="Supprimer"
        destructive
        pending={busy}
        onCancel={() => setPending(null)}
        onConfirm={() =>
          pending && run(() => deleteSnapshotAction(serverId, pending.name))
        }
      />
      <ConfirmDialog
        open={pending?.kind === "rollback"}
        title="Restaurer ce snapshot ?"
        description="Le VPS revient à l'état du snapshot : toutes les modifications faites depuis seront perdues."
        confirmLabel="Restaurer"
        requireText={pending?.name}
        destructive
        pending={busy}
        onCancel={() => setPending(null)}
        onConfirm={() =>
          pending &&
          run(() =>
            rollbackSnapshotAction(serverId, pending.name, pending.name)
          )
        }
      />
    </div>
  )
}

"use client"

import { useState, useTransition } from "react"
import { CheckIcon } from "lucide-react"

import { AutoRefresh } from "@/components/auto-refresh"
import { StatusBadge } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { installAppsAction, type AppsState } from "@/lib/apps/actions"
import { APPS, appById, withDependencies } from "@/lib/apps/catalog"

const STATUS = {
  queued: { label: "En attente", tone: "neutral" },
  running: { label: "Installation…", tone: "info" },
  success: { label: "Installé", tone: "success" },
  failed: { label: "Échec", tone: "danger" },
} as const

const CATEGORIES = [...new Set(APPS.map((a) => a.category))]

/** Cases à cocher du catalogue (dépendances ajoutées automatiquement). */
export function AppPicker({
  selected,
  onChange,
  installed = [],
  name,
}: {
  selected: string[]
  onChange: (ids: string[]) => void
  /** Applications déjà installées ou en cours (non sélectionnables). */
  installed?: string[]
  /** Nom des champs de formulaire (commande d'un VPS). */
  name?: string
}) {
  const withDeps = withDependencies(selected)
  return (
    <div className="flex flex-col gap-4">
      {CATEGORIES.map((cat) => (
        <fieldset key={cat} className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {cat}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {APPS.filter((a) => a.category === cat).map((a) => {
              const done = installed.includes(a.id)
              const auto = !selected.includes(a.id) && withDeps.includes(a.id)
              return (
                <label
                  key={a.id}
                  className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${done ? "opacity-60" : "cursor-pointer has-checked:border-primary has-checked:bg-primary/5"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    name={name}
                    value={a.id}
                    disabled={done}
                    checked={done || selected.includes(a.id) || auto}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...selected, a.id]
                          : selected.filter((x) => x !== a.id)
                      )
                    }
                  />
                  <span>
                    <span className="flex flex-wrap items-center gap-1.5 font-medium">
                      {a.name}
                      {done && (
                        <CheckIcon
                          className="size-4 text-emerald-600"
                          aria-label="installé"
                        />
                      )}
                      {auto && !done && (
                        <span className="text-xs font-normal text-muted-foreground">
                          (requis)
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {a.description}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}

type Install = {
  id: string
  appId: string
  status: keyof typeof STATUS
  log: string | null
  createdAt: string
  finishedAt: string | null
}

export function AppsPanel({
  serverId,
  installs,
  disabledReason,
}: {
  serverId: string
  installs: Install[]
  disabledReason: string | null
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [pending, start] = useTransition()
  const [state, setState] = useState<AppsState>(undefined)
  const active = installs.some(
    (i) => i.status === "queued" || i.status === "running"
  )
  const taken = installs
    .filter((i) => i.status !== "failed")
    .map((i) => i.appId)
  const toInstall = withDependencies(selected).filter(
    (id) => !taken.includes(id)
  )
  const nesting = toInstall.some((id) => appById(id)?.needsNesting)
  const succeeded = installs.filter((i) => i.status === "success")

  return (
    <div className="flex flex-col gap-6">
      {active && <AutoRefresh seconds={5} />}
      {disabledReason ? (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          {disabledReason}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <AppPicker
            selected={selected}
            onChange={setSelected}
            installed={taken}
          />
          {nesting && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Docker nécessite d&apos;activer des options du conteneur : le VPS
              redémarrera une fois pendant l&apos;installation.
            </p>
          )}
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state?.ok && (
            <p
              role="status"
              className="text-sm text-emerald-700 dark:text-emerald-400"
            >
              {state.notice}
            </p>
          )}
          <div>
            <Button
              disabled={pending || toInstall.length === 0}
              onClick={() =>
                start(async () => {
                  const r = await installAppsAction(serverId, selected)
                  setState(r)
                  if (r?.ok) setSelected([])
                })
              }
            >
              {pending
                ? "…"
                : toInstall.length
                  ? `Installer ${toInstall.length} application(s)`
                  : "Choisis des applications"}
            </Button>
          </div>
        </div>
      )}

      {succeeded.some(
        (i) => appById(i.appId)?.afterInstall || appById(i.appId)?.ports
      ) && (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <p className="font-medium">Pour bien démarrer</p>
          <ul className="flex flex-col gap-1.5">
            {succeeded.map((i) => {
              const a = appById(i.appId)
              if (!a || (!a.afterInstall && !a.ports)) return null
              return (
                <li key={i.id}>
                  <strong>{a.name}</strong>
                  {a.afterInstall && <> : {a.afterInstall}</>}
                  {a.ports && (
                    <span className="block text-xs text-muted-foreground">
                      Ports à ouvrir dans le pare-feu (onglet Réseau) :{" "}
                      {a.ports.map((p) => `${p.port} (${p.label})`).join(", ")}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {installs.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Historique</p>
          <ul className="flex flex-col gap-2">
            {installs.map((i) => {
              const st = STATUS[i.status]
              return (
                <li key={i.id} className="rounded-lg border p-3 text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {appById(i.appId)?.name ?? i.appId}
                      </span>
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(i.finishedAt ?? i.createdAt).toLocaleString(
                          "fr-FR",
                          {
                            dateStyle: "short",
                            timeStyle: "short",
                          }
                        )}
                      </span>
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-black p-3 font-mono text-xs whitespace-pre-wrap text-zinc-100">
                      {i.log ??
                        (i.status === "failed"
                          ? "Aucun détail."
                          : "En attente du journal…")}
                    </pre>
                  </details>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

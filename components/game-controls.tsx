"use client"

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react"
import {
  PlayIcon,
  RotateCwIcon,
  SendIcon,
  SquareIcon,
  ZapOffIcon,
} from "lucide-react"

import { StatusBadge } from "@/components/kit"
import { ConfirmDialog, CopyButton } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatBytes, formatUptime } from "@/lib/format"
import {
  createGameAction,
  deleteGameAction,
  deleteGamePlanAction,
  gameCommandAction,
  gamePowerAction,
  reinstallGameAction,
  saveGamePlanAction,
  setGameSuspendedAction,
  type GameState,
} from "@/lib/games/actions"

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

function Feedback({ state }: { state: GameState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    )
  }
  if (state?.ok && state.notice) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {state.notice}
      </p>
    )
  }
  return null
}

/* ───────────── Commande ───────────── */

type PlanCard = {
  id: string
  name: string
  description: string | null
  eggName: string | null
  price: string
  specs: string[]
}

export function OrderGameForm({ plans }: { plans: PlanCard[] }) {
  const [state, action, pending] = useActionState(createGameAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-medium">Offre</legend>
        {plans.map((p, i) => (
          <label
            key={p.id}
            className="flex cursor-pointer flex-col gap-1 rounded-xl border p-4 text-sm has-checked:border-primary has-checked:bg-primary/5"
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="planId"
                value={p.id}
                defaultChecked={i === 0}
                required
              />
              <span className="font-medium">{p.name}</span>
            </span>
            {p.eggName && (
              <span className="text-xs text-muted-foreground">{p.eggName}</span>
            )}
            <span className="text-lg font-semibold">{p.price}</span>
            <ul className="text-xs text-muted-foreground">
              {p.specs.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            {p.description && (
              <span className="text-xs text-muted-foreground">
                {p.description}
              </span>
            )}
          </label>
        ))}
      </fieldset>
      <label className="flex max-w-sm flex-col gap-1.5 text-sm">
        <span className="font-medium">Nom du serveur</span>
        <Input
          name="name"
          required
          minLength={2}
          maxLength={60}
          placeholder="Mon serveur"
        />
      </label>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Création en cours…" : "Créer le serveur"}
        </Button>
      </div>
    </form>
  )
}

/* ───────────── État en direct + alimentation ───────────── */

type Live = {
  ok: boolean
  state?: string
  cpuPercent?: number
  memoryBytes?: number
  diskBytes?: number
  uptimeMs?: number
  error?: string
}

const STATE: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }
> = {
  running: { label: "En ligne", tone: "success" },
  starting: { label: "Démarrage…", tone: "info" },
  stopping: { label: "Arrêt…", tone: "warning" },
  offline: { label: "Éteint", tone: "neutral" },
  installing: { label: "Installation…", tone: "info" },
  install_failed: { label: "Installation échouée", tone: "danger" },
  suspended: { label: "Suspendu", tone: "danger" },
}

export function GameLive({
  id,
  memoryLimitMb,
  diskLimitMb,
  disabled,
}: {
  id: string
  memoryLimitMb: number
  diskLimitMb: number
  disabled: boolean
}) {
  const [live, setLive] = useState<Live | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    const load = async () => {
      if (document.visibilityState !== "visible") return
      try {
        const r = await fetch(`/api/games/${id}/resources`, {
          cache: "no-store",
        })
        const j = (await r.json()) as Live
        if (!stop) setLive(j)
      } catch {
        if (!stop) setLive({ ok: false, error: "Indisponible" })
      }
    }
    void load()
    const t = setInterval(load, 5000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [id])

  const state = live?.state ?? "unknown"
  const st = STATE[state] ?? {
    label: live?.ok === false ? "Indisponible" : "…",
    tone: "neutral" as const,
  }
  const busy =
    pending || disabled || state === "installing" || state === "suspended"

  const power = (signal: "start" | "stop" | "restart" | "kill") =>
    start(async () => {
      setError(null)
      const r = await gamePowerAction(id, signal)
      if (r?.error) setError(r.error)
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || state === "running" || state === "starting"}
            onClick={() => power("start")}
          >
            <PlayIcon /> Démarrer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || state === "offline"}
            onClick={() => power("restart")}
          >
            <RotateCwIcon /> Redémarrer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || state === "offline"}
            onClick={() => power("stop")}
          >
            <SquareIcon /> Arrêter
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy || state === "offline"}
            title="Forcer l'arrêt (perte possible de données non sauvegardées)"
            onClick={() => power("kill")}
          >
            <ZapOffIcon /> Forcer
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {live?.ok === false && live.error && (
        <p className="text-sm text-muted-foreground">{live.error}</p>
      )}
      {live?.ok && live.memoryBytes !== undefined && (
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Processeur</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {(live.cpuPercent ?? 0).toFixed(1)} %
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Mémoire</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatBytes(live.memoryBytes)}
              <span className="text-xs font-normal text-muted-foreground">
                {" "}
                /{" "}
                {memoryLimitMb ? formatBytes(memoryLimitMb * 1024 * 1024) : "∞"}
              </span>
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">Disque</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatBytes(live.diskBytes ?? 0)}
              <span className="text-xs font-normal text-muted-foreground">
                {" "}
                / {diskLimitMb ? formatBytes(diskLimitMb * 1024 * 1024) : "∞"}
              </span>
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground">En ligne depuis</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {live.uptimeMs ? formatUptime(live.uptimeMs) : "—"}
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}

/* ───────────── Console ───────────── */

// Codes de couleur ANSI retirés (affichage texte brut, sans HTML).
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

export function GameConsole({
  id,
  disabled,
}: {
  id: string
  disabled: boolean
}) {
  const [lines, setLines] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [cmd, setCmd] = useState("")
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (disabled) return
    const es = new EventSource(`/api/games/${id}/console`)
    es.addEventListener("line", (e) => {
      const line = (JSON.parse((e as MessageEvent).data) as string).replace(
        ANSI,
        ""
      )
      setLines((prev) => {
        const next = [...prev, line]
        return next.length > 400 ? next.slice(-400) : next
      })
    })
    es.addEventListener("reset", () => setLines([]))
    es.addEventListener("status", (e) =>
      setStatus(JSON.parse((e as MessageEvent).data) as string)
    )
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data
      if (typeof data === "string") setStatus(JSON.parse(data) as string)
    })
    return () => es.close()
  }, [id, disabled])

  useEffect(() => {
    const el = box.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight
    }
  }, [lines])

  if (disabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Console indisponible tant que le serveur est suspendu.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <pre
        ref={box}
        aria-live="off"
        className="h-80 overflow-auto rounded-lg bg-black p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-100"
      >
        {lines.length ? lines.join("\n") : "En attente de la console…"}
      </pre>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const c = cmd.trim()
          if (!c) return
          start(async () => {
            setError(null)
            const r = await gameCommandAction(id, c)
            if (r?.error) setError(r.error)
            else setCmd("")
          })
        }}
      >
        <Input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          maxLength={500}
          placeholder="Commande (ex. say Bonjour)"
          aria-label="Commande à envoyer au serveur"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <Button
          type="submit"
          disabled={pending || !cmd.trim()}
          aria-label="Envoyer"
        >
          <SendIcon />
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        {error ? (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        ) : status ? (
          `État du démon : ${status}`
        ) : (
          "Connexion à la console…"
        )}
      </p>
    </div>
  )
}

/* ───────────── Zone dangereuse ───────────── */

export function GameDangerZone({ id, name }: { id: string; name: string }) {
  const [confirm, setConfirm] = useState<"reinstall" | "delete" | null>(null)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<GameState>(undefined)
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setConfirm("reinstall")}>
        Réinstaller
      </Button>
      <Button variant="destructive" onClick={() => setConfirm("delete")}>
        Supprimer le serveur
      </Button>
      <div className="basis-full">
        <Feedback state={msg} />
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "delete"
            ? `Supprimer « ${name} » ?`
            : `Réinstaller « ${name} » ?`
        }
        description={
          confirm === "delete"
            ? "Le serveur et tous ses fichiers seront définitivement supprimés."
            : "Le script d'installation est relancé : des fichiers peuvent être écrasés."
        }
        confirmLabel={confirm === "delete" ? "Supprimer" : "Réinstaller"}
        requireText={confirm === "delete" ? name : undefined}
        destructive
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          start(async () => {
            const r =
              confirm === "delete"
                ? await deleteGameAction(id)
                : await reinstallGameAction(id)
            setConfirm(null)
            setMsg(r)
          })
        }
      />
    </div>
  )
}

export function AddressCopy({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      {address}
      <CopyButton value={address} label="Copier l'adresse" />
    </span>
  )
}

/* ───────────── Administration ───────────── */

type EggOption = { value: string; label: string }
type LocationOption = { id: number; label: string }
type PlanValues = {
  id: string
  name: string
  description: string | null
  priceCents: number
  nestId: number
  eggId: number
  locationId: number
  memoryMb: number
  diskMb: number
  cpuPercent: number
  databases: number
  backups: number
  environment: Record<string, string>
  periodDays: number | null
  isActive: boolean
}

export function GamePlanForm({
  plan,
  eggs,
  locations,
}: {
  plan?: PlanValues
  eggs: EggOption[]
  locations: LocationOption[]
}) {
  const [state, action, pending] = useActionState(saveGamePlanAction, undefined)
  const num = (
    name: string,
    label: string,
    value: number | undefined,
    min = 0
  ) => (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        name={name}
        type="number"
        min={min}
        defaultValue={value}
        required
      />
    </label>
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Nom</span>
          <Input
            name="name"
            defaultValue={plan?.name}
            required
            maxLength={80}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Egg (jeu)</span>
          <select
            name="egg"
            defaultValue={plan ? `${plan.nestId}:${plan.eggId}` : ""}
            required
            className={selectClass}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {eggs.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Emplacement</span>
          <select
            name="locationId"
            defaultValue={plan?.locationId ?? ""}
            required
            className={selectClass}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {num("memoryMb", "Mémoire (Mo)", plan?.memoryMb ?? 2048, 128)}
        {num("diskMb", "Disque (Mo)", plan?.diskMb ?? 10240, 256)}
        {num(
          "cpuPercent",
          "CPU (% ; 100 = 1 cœur, 0 = ∞)",
          plan?.cpuPercent ?? 100
        )}
        {num("databases", "Bases de données", plan?.databases ?? 0)}
        {num("backups", "Sauvegardes", plan?.backups ?? 0)}
        {num(
          "periodDays",
          "Période (jours, 0 = défaut)",
          plan?.periodDays ?? 0
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Prix (crédits / période)</span>
          <Input
            name="price"
            inputMode="decimal"
            defaultValue={
              plan ? String(plan.priceCents / 100).replace(".", ",") : "0"
            }
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Description</span>
          <Input
            name="description"
            defaultValue={plan?.description ?? ""}
            maxLength={300}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          Variables imposées (CLE=valeur, une par ligne ; sinon valeurs par
          défaut de l&apos;egg)
        </span>
        <textarea
          name="environment"
          defaultValue={Object.entries(plan?.environment ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")}
          placeholder={"MINECRAFT_VERSION=latest\nBUILD_NUMBER=latest"}
          className="min-h-20 rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={plan?.isActive ?? true}
        />
        Proposée à la commande
      </label>
      <Feedback state={state} />
      <div>
        <Button type="submit" size={plan ? "sm" : "default"} disabled={pending}>
          {pending ? "…" : plan ? "Enregistrer" : "Créer l'offre"}
        </Button>
      </div>
    </form>
  )
}

export function GamePlanRowActions({
  plan,
  eggs,
  locations,
}: {
  plan: PlanValues
  eggs: EggOption[]
  locations: LocationOption[]
}) {
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <Button
          size="xs"
          variant="outline"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Fermer" : "Modifier"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirm(true)}
        >
          Supprimer
        </Button>
      </div>
      {editing && (
        <div className="rounded-lg border p-3">
          <GamePlanForm plan={plan} eggs={eggs} locations={locations} />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Supprimer l'offre « ${plan.name} » ?`}
        description="Les serveurs existants continuent de fonctionner (sans offre liée, donc renouvelés gratuitement à la durée par défaut)."
        confirmLabel="Supprimer"
        destructive
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            await deleteGamePlanAction(plan.id)
            setConfirm(false)
          })
        }
      />
    </div>
  )
}

export function AdminGameActions({
  id,
  suspended,
}: {
  id: string
  suspended: boolean
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setGameSuspendedAction(id, !suspended)
            setError(r?.error ?? null)
          })
        }
      >
        {suspended ? "Réactiver" : "Suspendre"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  )
}

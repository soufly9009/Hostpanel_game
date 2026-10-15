"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  addRule,
  removeRule,
  addCatalogRules,
  autoConfigureFirewall,
  setFirewallEnabled,
  setRuleEnabled,
  type FirewallActionState,
} from "@/lib/firewall/actions"
import { FirewallCatalog } from "@/components/firewall-catalog"
import {
  FIREWALL_PROFILES,
  getProfile,
  type FirewallProfileId,
} from "@/lib/firewall/profiles"
import { isDuplicate } from "@/lib/firewall/rules"
import type { FirewallState } from "@/lib/proxmox/firewall"

type Loaded = (FirewallState & { error?: undefined }) | { error: string }

const PRESETS = [
  { label: "SSH (22)", proto: "tcp", dport: "22", comment: "SSH" },
  { label: "HTTP (80)", proto: "tcp", dport: "80", comment: "HTTP" },
  { label: "HTTPS (443)", proto: "tcp", dport: "443", comment: "HTTPS" },
  { label: "Ping (ICMP)", proto: "icmp", dport: "", comment: "Ping" },
] as const

const ACTION_LABEL = {
  ACCEPT: "Autoriser",
  DROP: "Bloquer",
  REJECT: "Rejeter",
} as const

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

export function FirewallPanel({
  serverId,
  disabled,
}: {
  serverId: string
  disabled: boolean
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [profile, setProfile] = useState<FirewallProfileId>("minimal")
  const [pending, startTransition] = useTransition()

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/firewall`, {
        cache: "no-store",
      })
      const json = await res.json()
      setData(res.ok ? json : { error: json.error ?? `HTTP ${res.status}` })
    } catch {
      setData({ error: "Réseau indisponible" })
    }
  }, [serverId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/servers/${serverId}/firewall`, {
          cache: "no-store",
        })
        const json = await res.json()
        if (!cancelled) {
          setData(res.ok ? json : { error: json.error ?? `HTTP ${res.status}` })
        }
      } catch {
        if (!cancelled) setData({ error: "Réseau indisponible" })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [serverId])

  const run = (fn: () => Promise<FirewallActionState>) => {
    setMessage(null)
    setNotice(null)
    startTransition(async () => {
      const res = await fn()
      if (res?.error) setMessage(res.error)
      else if (res?.notice) setNotice(res.notice)
      await refresh()
    })
  }

  const [form, formAction, formPending] = useActionState(
    async (prev: FirewallActionState, fd: FormData) => {
      const res = await addRule(prev, fd)
      await refresh()
      return res
    },
    undefined
  )

  const quickAdd = (p: (typeof PRESETS)[number]) => {
    const fd = new FormData()
    fd.set("serverId", serverId)
    fd.set("type", "in")
    fd.set("action", "ACCEPT")
    fd.set("proto", p.proto)
    fd.set("dport", p.dport)
    fd.set("comment", p.comment)
    run(() => addRule(undefined, fd))
  }

  if (!data) {
    return (
      <section className="rounded-xl border p-4 text-sm text-muted-foreground">
        Chargement du pare-feu…
      </section>
    )
  }
  if (data.error !== undefined) {
    return (
      <section className="rounded-xl border p-4 text-sm">
        <h2 className="mb-1 font-medium">Pare-feu</h2>
        <p className="text-destructive">{data.error}</p>
      </section>
    )
  }

  const fw = data
  const busy = pending || formPending || disabled
  const hasSsh = fw.rules.some(
    (r) =>
      r.enabled &&
      r.type === "in" &&
      r.action === "ACCEPT" &&
      (r.proto === null || r.proto === "tcp") &&
      (r.dport === null ||
        r.dport.split(",").some((p) => {
          const [a, b] = p.split(":").map(Number)
          return b === undefined ? a === 22 : a <= 22 && 22 <= b
        })) &&
      r.source === null
  )

  return (
    <section className="rounded-xl border">
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <h2 className="font-medium">Pare-feu</h2>
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
            fw.enabled
              ? "bg-green-500/10 text-green-600"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {fw.enabled ? "Activé" : "Désactivé"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="fw-policy" className="text-xs text-muted-foreground">
            Trafic entrant par défaut
          </label>
          <select
            id="fw-policy"
            className={`${selectClass} w-auto`}
            value={fw.policyIn === "ACCEPT" ? "ACCEPT" : "DROP"}
            disabled={busy}
            onChange={(e) =>
              run(() =>
                setFirewallEnabled(
                  serverId,
                  fw.enabled,
                  e.target.value as "ACCEPT" | "DROP"
                )
              )
            }
          >
            <option value="DROP">Bloquer</option>
            <option value="ACCEPT">Autoriser</option>
          </select>
          <Button
            size="sm"
            variant={fw.enabled ? "outline" : "default"}
            disabled={busy}
            onClick={() =>
              run(() =>
                setFirewallEnabled(
                  serverId,
                  !fw.enabled,
                  fw.enabled
                    ? fw.policyIn === "ACCEPT"
                      ? "ACCEPT"
                      : "DROP"
                    : "ACCEPT"
                )
              )
            }
          >
            {fw.enabled ? "Désactiver" : "Activer"}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-medium">Configuration automatique</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {getProfile(profile)?.description}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              aria-label="Profil de pare-feu"
              className={`${selectClass} w-auto`}
              value={profile}
              disabled={busy}
              onChange={(e) => setProfile(e.target.value as FirewallProfileId)}
            >
              {FIREWALL_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Appliquer ce profil ? Les règles manquantes seront ajoutées puis le pare-feu sera activé avec la politique du profil."
                  )
                ) {
                  run(() => autoConfigureFirewall(serverId, profile))
                }
              }}
            >
              Appliquer
            </Button>
          </div>
        </div>

        {notice && (
          <p className="rounded-lg bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
            {notice}
          </p>
        )}

        {fw.datacenterEnabled === false && (
          <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            Le pare-feu n&apos;est pas activé au niveau de l&apos;infrastructure
            : tes règles ne seront pas appliquées tant qu&apos;un administrateur
            ne l&apos;a pas activé (Datacenter → Firewall → Options).
          </p>
        )}
        {fw.enabled && fw.policyIn !== "ACCEPT" && !hasSsh && (
          <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            Le trafic entrant est bloqué par défaut et aucune règle
            n&apos;autorise le SSH (port 22) : tu risques de perdre l&apos;accès
            au VPS. Ajoute la règle « SSH » ou autorise le trafic entrant.
            <Button
              size="sm"
              variant="outline"
              className="mt-2 block"
              disabled={busy}
              onClick={() =>
                run(() => setFirewallEnabled(serverId, true, "ACCEPT"))
              }
            >
              Autoriser tout le trafic entrant
            </Button>
          </p>
        )}

        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Ajout rapide (trafic entrant autorisé)
            {fw.policyIn === "ACCEPT"
              ? " — le trafic entrant étant autorisé par défaut, ces règles servent en complément de blocages"
              : ""}
            :
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const present = isDuplicate(
                {
                  type: "in",
                  action: "ACCEPT",
                  proto: p.proto,
                  dport: p.dport,
                  source: null,
                },
                fw.rules
              )
              return (
                <Button
                  key={p.label}
                  size="sm"
                  variant="outline"
                  disabled={busy || present}
                  title={present ? "Cette règle existe déjà" : undefined}
                  onClick={() => quickAdd(p)}
                >
                  {present ? "✓" : "+"} {p.label}
                </Button>
              )
            })}
          </div>
        </div>

        <FirewallCatalog
          existing={fw.rules}
          busy={busy}
          onApply={(ids, source) =>
            run(() => addCatalogRules(serverId, ids, source))
          }
        />

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">Sens</th>
                <th className="p-2 font-medium">Action</th>
                <th className="p-2 font-medium">Protocole</th>
                <th className="p-2 font-medium">Port</th>
                <th className="p-2 font-medium">Source</th>
                <th className="p-2 font-medium">Note</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {fw.rules.map((r) => (
                <tr key={r.pos} className={r.enabled ? "" : "opacity-50"}>
                  <td className="p-2">
                    {r.type === "in" ? "Entrant" : "Sortant"}
                  </td>
                  <td className="p-2">{ACTION_LABEL[r.action]}</td>
                  <td className="p-2 font-mono text-xs">
                    {r.proto ?? r.macro ?? "tous"}
                  </td>
                  <td className="p-2 font-mono text-xs">{r.dport ?? "tous"}</td>
                  <td className="p-2 font-mono text-xs">
                    {r.source ?? "partout"}
                  </td>
                  <td className="max-w-40 truncate p-2 text-muted-foreground">
                    {r.comment}
                  </td>
                  <td className="p-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(() => setRuleEnabled(serverId, r.pos, !r.enabled))
                        }
                      >
                        {r.enabled ? "Pause" : "Activer"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => run(() => removeRule(serverId, r.pos))}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {fw.rules.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-3 text-center text-muted-foreground"
                  >
                    Aucune règle.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Règle personnalisée
          </summary>
          <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="serverId" value={serverId} />
            <label className="flex flex-col gap-1 text-xs">
              Sens
              <select name="type" className={selectClass} defaultValue="in">
                <option value="in">Entrant</option>
                <option value="out">Sortant</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Action
              <select
                name="action"
                className={selectClass}
                defaultValue="ACCEPT"
              >
                <option value="ACCEPT">Autoriser</option>
                <option value="DROP">Bloquer</option>
                <option value="REJECT">Rejeter</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Protocole
              <select name="proto" className={selectClass} defaultValue="tcp">
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
                <option value="">Tous</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Port(s)
              <Input name="dport" placeholder="80, 8000:8100" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Source (IP ou CIDR)
              <Input name="source" placeholder="203.0.113.0/24" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Note
              <Input name="comment" maxLength={60} />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" disabled={busy}>
                {formPending ? "Ajout…" : "Ajouter la règle"}
              </Button>
            </div>
          </form>
          {form?.error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {form.error}
            </p>
          )}
        </details>

        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
    </section>
  )
}

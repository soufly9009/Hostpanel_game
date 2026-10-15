"use client"

import { useCallback, useEffect, useState, useTransition } from "react"

import { ConfirmDialog, CopyButton } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { formatBytes, formatUptime } from "@/lib/format"
import type { LiveStatus } from "@/lib/provision"
import { deleteServer, power } from "@/lib/servers/actions"
import { cn } from "@/lib/utils"

type Live = Partial<LiveStatus> & { error?: string }
type PowerSignal = "start" | "stop" | "restart" | "kill"

export function ServerControls({
  serverId,
  suspended,
  initialIpv4,
  initialIpv6,
}: {
  serverId: string
  suspended: boolean
  initialIpv4: string | null
  initialIpv6: string | null
}) {
  const [live, setLive] = useState<Live | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState<
    "stop" | "kill" | "delete" | null
  >(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/resources`, {
        cache: "no-store",
      })
      setLive(await res.json())
    } catch {
      // on réessaiera au prochain tick
    }
  }, [serverId])

  useEffect(() => {
    // Synchronisation avec l'état Proxmox (source externe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [poll])

  function send(signal: PowerSignal) {
    setMessage(null)
    startTransition(async () => {
      const res = await power(serverId, signal)
      if (res?.error) setMessage(res.error)
      // Relit l'état réel : on n'affiche pas un succès supposé.
      await poll()
      setConfirming(null)
    })
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteServer(serverId)
      if (res?.error) {
        setMessage(res.error)
        setConfirming(null)
      }
    })
  }

  // IP : valeur en direct si connue, sinon celle enregistrée en base.
  const ipv4 = live?.ipv4 ?? initialIpv4
  const ipv6 = live?.ipv6 ?? initialIpv6

  const ready = live && !live.error && live.state !== undefined
  const running = ready && live.state === "running"
  const disabled = pending || suspended || !ready

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border p-4 text-sm">
        <h2 className="mb-3 font-medium">Connexion</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Address
            label="IPv4"
            ip={ipv4}
            waiting={running === false || !ready}
          />
          <Address
            label="IPv6"
            ip={ipv6}
            waiting={running === false || !ready}
          />
        </dl>
        {!ipv4 && !ipv6 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {running
              ? "En attente de l'adresse (DHCP). Sur une VM QEMU, l'agent invité (qemu-guest-agent) doit être installé pour la remonter."
              : "Les adresses s'affichent une fois le VPS démarré."}
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
          <span
            className={cn(
              "size-2 rounded-full",
              running ? "bg-green-500" : "bg-muted-foreground"
            )}
          />
          {suspended
            ? "Suspendu"
            : ready
              ? running
                ? "En ligne"
                : "Hors ligne"
              : live?.error
                ? "Indisponible"
                : "Chargement…"}
        </span>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void poll()}
          >
            Actualiser
          </Button>
          <Button
            size="sm"
            disabled={disabled || running === true}
            onClick={() => send("start")}
          >
            Démarrer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => send("restart")}
          >
            Redémarrer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !running}
            onClick={() => setConfirming("stop")}
          >
            Arrêter
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={disabled || !running}
            onClick={() => setConfirming("kill")}
          >
            Forcer l&apos;arrêt
          </Button>
        </div>
      </div>

      {live?.error && (
        <p role="alert" className="text-sm text-destructive">
          {live.error}
        </p>
      )}

      {ready && (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="CPU" value={`${(live.cpu ?? 0).toFixed(1)} %`} />
          <Stat
            label="Mémoire"
            value={`${formatBytes(live.memoryBytes ?? 0)}${
              live.memoryLimitBytes
                ? ` / ${formatBytes(live.memoryLimitBytes)}`
                : ""
            }`}
          />
          <Stat
            label="Disque"
            value={`${formatBytes(live.diskBytes ?? 0)}${
              live.diskLimitBytes
                ? ` / ${formatBytes(live.diskLimitBytes)}`
                : ""
            }`}
          />
          <Stat
            label="Uptime"
            value={running ? formatUptime(live.uptimeMs ?? 0) : "—"}
          />
          <Stat label="Réseau ↓" value={formatBytes(live.networkRx ?? 0)} />
          <Stat label="Réseau ↑" value={formatBytes(live.networkTx ?? 0)} />
        </dl>
      )}

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <div className="border-t pt-4">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          disabled={pending}
          onClick={() => setConfirming("delete")}
        >
          Supprimer le VPS
        </Button>
      </div>

      <ConfirmDialog
        open={confirming === "stop"}
        title="Arrêter le VPS ?"
        description="Arrêt propre du système. Les services du VPS seront indisponibles."
        confirmLabel="Arrêter"
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => send("stop")}
      />
      <ConfirmDialog
        open={confirming === "kill"}
        title="Forcer l'arrêt ?"
        description="Coupure immédiate, comme un débranchement : des données non écrites peuvent être perdues."
        confirmLabel="Forcer l'arrêt"
        destructive
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => send("kill")}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        title="Supprimer ce VPS ?"
        description="Le VPS et toutes ses données seront supprimés définitivement. Cette action est irréversible."
        confirmLabel="Supprimer définitivement"
        requireText="SUPPRIMER"
        destructive
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={remove}
      />
    </div>
  )
}

function Address({
  label,
  ip,
  waiting,
}: {
  label: string
  ip: string | null
  waiting: boolean
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono">
        {ip ? (
          <>
            <span className="break-all">{ip}</span>
            <CopyButton value={ip} label={`Copier ${label}`} />
            <span className="mt-0.5 block text-xs break-all text-muted-foreground">
              ssh root@{ip}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            {waiting ? "en attente…" : "non attribuée"}
          </span>
        )}
      </dd>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold break-all">{value}</dd>
    </div>
  )
}

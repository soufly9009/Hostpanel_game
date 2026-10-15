"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { StatusBadge } from "@/components/kit"
import { ConfirmDialog } from "@/components/kit-client"
import { NetworkPicker, type NetworkChoice } from "@/components/network-picker"
import { Button } from "@/components/ui/button"
import {
  changeNetworkAction,
  verifyNetworkAction,
} from "@/lib/servers/network-actions"

type Props = {
  serverId: string
  disabled: boolean
  current: {
    mode: "dhcp" | "static" | null
    ipv4: string | null
    ipv6: string | null
    network: {
      name: string
      cidr: string
      gateway: string | null
      dns: string[]
      vlan: number | null
    } | null
    syncState: "pending" | "synced" | "error" | null
    error: string | null
    updatedAt: string | null
    /** Ancienne adresse conservée jusqu'à confirmation. */
    previousAddress: string | null
  }
  /** Le type de VPS applique-t-il le changement à chaud ? */
  virt: "lxc" | "qemu"
}

const SYNC = {
  synced: { text: "Synchronisé", tone: "success" },
  pending: { text: "En attente de confirmation", tone: "warning" },
  error: { text: "Erreur", tone: "danger" },
} as const

export function NetworkPanel({ serverId, disabled, current, virt }: Props) {
  const router = useRouter()
  const [choice, setChoice] = useState<NetworkChoice>({
    mode: "dhcp",
    networkId: "",
    addressId: "",
  })
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null
  )

  const valid =
    choice.mode === "dhcp"
      ? true
      : Boolean(choice.networkId && choice.addressId)

  function apply() {
    setResult(null)
    start(async () => {
      const res = await changeNetworkAction(serverId, {
        mode: choice.mode,
        networkId: choice.networkId || null,
        addressId: choice.addressId || null,
        acknowledged: true,
      })
      setConfirming(false)
      if (res?.error) setResult({ ok: false, text: res.error })
      else
        setResult({
          ok: true,
          text: res?.notice ?? "Configuration enregistrée.",
        })
      router.refresh()
    })
  }

  function verify() {
    setResult(null)
    start(async () => {
      const res = await verifyNetworkAction(serverId)
      if (res?.error) setResult({ ok: false, text: res.error })
      else setResult({ ok: true, text: res?.notice ?? "Confirmé." })
      router.refresh()
    })
  }

  const sync = current.syncState ? SYNC[current.syncState] : null

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Configuration actuelle</h2>
          {sync && <StatusBadge tone={sync.tone}>{sync.text}</StatusBadge>}
        </div>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Mode</dt>
            <dd>
              {current.mode === "static"
                ? "Adresse IP statique"
                : current.mode === "dhcp"
                  ? "DHCP"
                  : "DHCP (par défaut)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">IPv4</dt>
            <dd className="font-mono">{current.ipv4 ?? "non attribuée"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">IPv6</dt>
            <dd className="font-mono break-all">{current.ipv6 ?? "—"}</dd>
          </div>
          {current.network && (
            <>
              <div>
                <dt className="text-muted-foreground">Réseau</dt>
                <dd>
                  {current.network.name}{" "}
                  <span className="font-mono text-xs">
                    {current.network.cidr}
                  </span>
                  {current.network.vlan
                    ? ` · VLAN ${current.network.vlan}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Passerelle</dt>
                <dd className="font-mono">{current.network.gateway ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">DNS</dt>
                <dd className="font-mono">
                  {current.network.dns.join(", ") || "—"}
                </dd>
              </div>
            </>
          )}
          {current.updatedAt && (
            <div>
              <dt className="text-muted-foreground">Dernière modification</dt>
              <dd>
                {new Date(current.updatedAt).toLocaleString("fr-FR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          )}
          {current.previousAddress && (
            <div>
              <dt className="text-muted-foreground">
                Ancienne adresse (libérée après confirmation)
              </dt>
              <dd className="font-mono">{current.previousAddress}</dd>
            </div>
          )}
        </dl>

        {current.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {current.error}
          </p>
        )}

        <div className="mt-4">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || disabled}
            onClick={verify}
          >
            {pending ? "…" : "Vérifier la synchronisation"}
          </Button>
          <span className="ml-3 text-xs text-muted-foreground">
            Compare la configuration aux adresses réellement observées.
          </span>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">Modifier la configuration réseau</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {virt === "qemu"
            ? "VM : la nouvelle configuration cloud-init s'applique au prochain redémarrage."
            : "Conteneur : la configuration est appliquée au conteneur, une brève coupure est possible."}
        </p>

        <div className="mt-4 max-w-xl">
          <NetworkPicker
            endpoint={`/api/servers/${serverId}/network`}
            onChange={setChoice}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            size="sm"
            disabled={pending || disabled || !valid}
            onClick={() => setConfirming(true)}
          >
            Appliquer
          </Button>
          {disabled && (
            <span className="text-xs text-muted-foreground">
              VPS suspendu : modification impossible.
            </span>
          )}
        </div>
      </section>

      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`text-sm ${result.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {result.text}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title="Modifier la configuration réseau ?"
        description={
          <>
            La connectivité du VPS peut être interrompue pendant le changement
            (y compris la session SSH en cours). L&apos;ancienne adresse reste
            réservée jusqu&apos;à confirmation de la nouvelle.
          </>
        }
        confirmLabel="Appliquer le changement"
        destructive
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={apply}
      />
    </div>
  )
}

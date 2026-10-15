"use client"

import { useEffect, useMemo, useState } from "react"

type Option = {
  id: string
  name: string
  cidr: string
  family: "ipv4" | "ipv6"
  gateway: string | null
  dns: string[]
  vlan: number | null
  dhcp: boolean
  static: boolean
  addresses: { id: string; address: string }[]
  availableCount: number
}
type Options = {
  planModes: "dhcp" | "static" | "both"
  networks: Option[]
}

export type NetworkChoice = {
  mode: "dhcp" | "static"
  networkId: string
  addressId: string
}

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"

/**
 * Choix DHCP / IP statique. Les champs portent un `name` : utilisable dans un
 * <form> natif (création) ou via `onChange` (page de configuration).
 * Rien n'est de confiance : le serveur revalide réseau, adresse et mode.
 */
export function NetworkPicker({
  endpoint,
  onChange,
}: {
  /** URL JSON des options (par offre ou par VPS). null = pas encore choisi. */
  endpoint: string | null
  onChange?: (choice: NetworkChoice) => void
}) {
  const [data, setData] = useState<{
    key: string
    opts: Options | null
    error: string | null
  } | null>(null)
  const [mode, setMode] = useState<"dhcp" | "static">("dhcp")
  const [networkId, setNetworkId] = useState("")
  const [addressId, setAddressId] = useState("")

  useEffect(() => {
    if (!endpoint) return
    const controller = new AbortController()
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok) throw new Error(json.error ?? `Erreur ${r.status}`)
        setData({ key: endpoint, opts: json as Options, error: null })
      })
      .catch((e) => {
        if (controller.signal.aborted) return
        setData({
          key: endpoint,
          opts: null,
          error: e instanceof Error ? e.message : "Erreur",
        })
      })
    return () => controller.abort()
  }, [endpoint])

  const loading = endpoint !== null && data?.key !== endpoint
  const opts = data?.key === endpoint ? data.opts : null
  const error = data?.key === endpoint ? data.error : null

  const nets = useMemo(
    () =>
      (opts?.networks ?? []).filter((n) =>
        mode === "static" ? n.static : n.dhcp
      ),
    [opts, mode]
  )
  const net = nets.find((n) => n.id === networkId) ?? nets[0]
  const effectiveNetworkId = net?.id ?? ""
  const addr =
    net?.addresses.find((a) => a.id === addressId) ?? net?.addresses[0]
  const effectiveAddressId = mode === "static" ? (addr?.id ?? "") : ""

  const canStatic = (opts?.networks ?? []).some((n) => n.static)
  const canDhcp = (opts?.networks ?? []).some((n) => n.dhcp)
  // « DHCP simple » : l'offre le permet mais aucun réseau IPAM n'est déclaré.
  const legacyDhcp =
    !!opts && opts.planModes !== "static" && (opts.networks ?? []).length === 0

  // Remonte le choix effectif au parent (formulaire contrôlé).
  useEffect(() => {
    onChange?.({
      mode,
      networkId: effectiveNetworkId,
      addressId: effectiveAddressId,
    })
  }, [mode, effectiveNetworkId, effectiveAddressId, onChange])

  if (!endpoint) return null
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">
        Chargement des réseaux disponibles…
      </p>
    )
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Réseaux indisponibles : {error}
      </p>
    )
  }
  if (!opts) return null

  const dhcpPossible = opts.planModes !== "static" && (canDhcp || legacyDhcp)
  const staticPossible = opts.planModes !== "dhcp" && canStatic

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">Configuration réseau</legend>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="networkMode"
            value="dhcp"
            checked={mode === "dhcp"}
            disabled={!dhcpPossible}
            onChange={() => setMode("dhcp")}
          />
          DHCP automatique
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="networkMode"
            value="static"
            checked={mode === "static"}
            disabled={!staticPossible}
            onChange={() => setMode("static")}
          />
          Adresse IP statique
        </label>
      </div>

      {!dhcpPossible && (
        <p className="text-xs text-muted-foreground">
          DHCP indisponible :{" "}
          {opts.planModes === "static"
            ? "cette offre ne le propose pas."
            : "aucun serveur DHCP n'est déclaré sur les réseaux de cette offre."}
        </p>
      )}
      {!staticPossible && (
        <p className="text-xs text-muted-foreground">
          IP statique indisponible :{" "}
          {opts.planModes === "dhcp"
            ? "cette offre ne la propose pas."
            : "aucune adresse libre n'est proposée pour cette offre."}
        </p>
      )}

      {mode === "dhcp" && legacyDhcp && (
        <p className="text-xs text-muted-foreground">
          L&apos;adresse sera attribuée par le serveur DHCP du réseau. Elle
          s&apos;affichera une fois l&apos;attribution confirmée.
        </p>
      )}

      {nets.length > 0 && (
        <>
          <label className="flex flex-col gap-1.5 text-sm">
            Réseau
            <select
              name="networkId"
              value={effectiveNetworkId}
              onChange={(e) => {
                setNetworkId(e.target.value)
                setAddressId("")
              }}
              className={selectClass}
            >
              {nets.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} — {n.cidr}
                  {n.vlan ? ` (VLAN ${n.vlan})` : ""}
                </option>
              ))}
            </select>
          </label>

          {net && (
            <dl className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Réseau</dt>
                <dd className="font-mono">{net.cidr}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Passerelle</dt>
                <dd className="font-mono">{net.gateway ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">DNS</dt>
                <dd className="font-mono">{net.dns.join(", ") || "—"}</dd>
              </div>
            </dl>
          )}

          {mode === "static" && net && (
            <label className="flex flex-col gap-1.5 text-sm">
              Adresse IP
              <select
                name="ipAddressId"
                value={effectiveAddressId}
                onChange={(e) => setAddressId(e.target.value)}
                className={selectClass}
                required
              >
                {net.addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.address}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {net.availableCount > net.addresses.length
                  ? `${net.addresses.length}+ adresses libres (liste limitée).`
                  : `${net.addresses.length} adresse(s) libre(s).`}{" "}
                L&apos;adresse est réservée au moment de la validation.
              </span>
            </label>
          )}

          {mode === "dhcp" && (
            <p className="text-xs text-muted-foreground">
              L&apos;adresse finale est attribuée par le serveur DHCP : elle
              n&apos;est affichée qu&apos;une fois confirmée.
            </p>
          )}
        </>
      )}
    </fieldset>
  )
}

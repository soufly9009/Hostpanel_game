"use client"

import { useActionState, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createPlan } from "@/lib/admin/actions"

type Virt = "lxc" | "qemu"
type Option = { value: string; label: string }
type Loaded = {
  key: string
  options: Option[]
  info: string | null
  error: string | null
}

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

/**
 * Charge une liste d'options à la demande. `loading` est dérivé de la clé
 * (url|refresh) pour éviter tout setState synchrone dans l'effet.
 */
function useRemoteOptions(url: string | null) {
  const [refresh, setRefresh] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const key = `${url}|${refresh}`

  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        setLoaded({
          key,
          options: json.options,
          info: json.info ?? null,
          error: null,
        })
      } catch (e) {
        if (controller.signal.aborted) return
        setLoaded({
          key,
          options: [],
          info: null,
          error: e instanceof Error ? e.message : "Erreur",
        })
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [url, key])

  const current = loaded?.key === key ? loaded : null
  return {
    loading: url !== null && current === null,
    options: current?.options ?? [],
    info: current?.info ?? null,
    error: current?.error ?? null,
    reload: () => setRefresh((n) => n + 1),
  }
}

/**
 * Sélecteur alimenté par Proxmox. Retombe sur une saisie manuelle si la liste
 * est vide ou indisponible.
 */
function RemoteSelect({
  id,
  name,
  label,
  kind,
  node,
  virt,
  placeholder,
  hint,
  defaultValue,
}: {
  id: string
  name: string
  label: string
  kind: "templates" | "storages" | "bridges"
  node: string
  virt: Virt
  placeholder: string
  hint: string
  defaultValue?: string
}) {
  const url = node.trim()
    ? `/api/admin/proxmox/options?kind=${kind}&node=${encodeURIComponent(node.trim())}&virt=${virt}`
    : null
  const { loading, options, info, error, reload } = useRemoteOptions(url)
  const [manual, setManual] = useState(false)

  const empty = !loading && url !== null && options.length === 0
  const useManual = manual || url === null || error !== null || empty

  return (
    <Field
      id={id}
      label={label}
      hint={
        error
          ? `Chargement impossible : ${error}`
          : empty
            ? `Aucun élément trouvé : saisie manuelle.${info ? ` Détail : ${info}` : ""}`
            : hint
      }
    >
      <div className="flex gap-2">
        {useManual ? (
          <Input
            id={id}
            name={name}
            placeholder={placeholder}
            defaultValue={defaultValue}
            required
          />
        ) : (
          <select
            id={id}
            name={name}
            className={selectClass}
            disabled={loading}
            required
            defaultValue={
              options.some((o) => o.value === defaultValue) ? defaultValue : ""
            }
          >
            <option value="" disabled>
              {loading ? "Chargement…" : "Choisir…"}
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={loading || url === null}
          onClick={() => {
            setManual(false)
            reload()
          }}
        >
          {loading ? "…" : "Actualiser"}
        </Button>
      </div>
      {!useManual && options.length > 0 && (
        <button
          type="button"
          onClick={() => setManual(true)}
          className="self-start text-xs text-muted-foreground underline underline-offset-4"
        >
          Saisir manuellement
        </button>
      )}
    </Field>
  )
}

/** Templates que le client pourra choisir lors d'une réinstallation. */
function AllowedTemplates({ node, virt }: { node: string; virt: Virt }) {
  const url = node.trim()
    ? `/api/admin/proxmox/options?kind=templates&node=${encodeURIComponent(node.trim())}&virt=${virt}`
    : null
  const { loading, options, error } = useRemoteOptions(url)

  if (url === null || error || (!loading && options.length === 0)) return null

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">
        Systèmes proposés à la réinstallation
      </legend>
      <p className="text-xs text-muted-foreground">
        Le template par défaut est toujours proposé. Coche les autres systèmes
        que le client pourra choisir.
      </p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Chargement…</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allowedTemplates"
                value={JSON.stringify(o)}
              />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

export function VpsPlanForm({ nodes }: { nodes: string[] }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof createPlan>>, fd: FormData) => {
      const res = await createPlan(prev, fd)
      if (res?.ok) formRef.current?.reset()
      return res
    },
    undefined
  )
  const [virt, setVirt] = useState<Virt>("lxc")
  const [node, setNode] = useState(nodes[0] ?? "")

  return (
    <form
      ref={formRef}
      action={action}
      className="flex max-w-3xl flex-col gap-5 rounded-xl border p-5"
    >
      <h2 className="font-medium">Nouvelle offre Proxmox</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="vps-name" label="Nom">
          <Input
            id="vps-name"
            name="name"
            placeholder="VPS Debian 2 Go"
            required
          />
        </Field>
        <Field id="vps-price" label="Prix (€ / mois)">
          <Input
            id="vps-price"
            name="priceEuros"
            type="number"
            min={0}
            step="0.01"
            defaultValue={0}
            required
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="vps-desc" label="Description">
            <Input id="vps-desc" name="description" maxLength={300} />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="virt" label="Type">
          <select
            id="virt"
            name="virt"
            className={selectClass}
            value={virt}
            onChange={(e) => setVirt(e.target.value as Virt)}
          >
            <option value="lxc">Conteneur LXC</option>
            <option value="qemu">Machine virtuelle QEMU/KVM</option>
          </select>
        </Field>
        <Field id="node" label="Nœud">
          {nodes.length > 0 ? (
            <select
              id="node"
              name="node"
              className={selectClass}
              value={node}
              onChange={(e) => setNode(e.target.value)}
              required
            >
              {nodes.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          ) : (
            <Input
              id="node"
              name="node"
              placeholder="pve"
              value={node}
              onChange={(e) => setNode(e.target.value)}
              required
            />
          )}
        </Field>

        {/* `key` : repart d'un sélecteur propre quand le nœud ou le type change. */}
        <RemoteSelect
          key={`tpl|${node}|${virt}`}
          id="template"
          name="template"
          label={virt === "lxc" ? "Template LXC" : "Template QEMU"}
          kind="templates"
          node={node}
          virt={virt}
          placeholder={virt === "lxc" ? "local:vztmpl/…" : "9000"}
          hint={
            virt === "lxc"
              ? "Archive LXC disponible sur le nœud"
              : "VM template (cloud-init) à cloner"
          }
        />
        <RemoteSelect
          key={`sto|${node}|${virt}`}
          id="storage"
          name="storage"
          label="Stockage du disque"
          kind="storages"
          node={node}
          virt={virt}
          placeholder="local-lvm"
          hint="Stockage actif du nœud"
          defaultValue="local-lvm"
        />
        <RemoteSelect
          key={`br|${node}`}
          id="bridge"
          name="bridge"
          label="Pont réseau"
          kind="bridges"
          node={node}
          virt={virt}
          placeholder="vmbr0"
          hint="Bridge du nœud"
          defaultValue="vmbr0"
        />
      </div>

      <AllowedTemplates
        key={`allowed|${node}|${virt}`}
        node={node}
        virt={virt}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Field id="cores" label="vCPU">
          <Input
            id="cores"
            name="cores"
            type="number"
            min={1}
            defaultValue={2}
            required
          />
        </Field>
        <Field id="vps-mem" label="RAM (Mo)">
          <Input
            id="vps-mem"
            name="memoryMb"
            type="number"
            min={128}
            defaultValue={2048}
            required
          />
        </Field>
        <Field id="vps-disk" label="Disque (Go)">
          <Input
            id="vps-disk"
            name="diskGb"
            type="number"
            min={1}
            defaultValue={20}
            required
          />
        </Field>
        <Field id="vps-swap" label="Swap (Mo)" hint="LXC uniquement">
          <Input
            id="vps-swap"
            name="swapMb"
            type="number"
            min={0}
            defaultValue={512}
            required
          />
        </Field>
        <Field
          id="vps-period"
          label="Durée de renouvellement (jours)"
          hint="Vide = valeur par défaut du site"
        >
          <Input
            id="vps-period"
            name="periodDays"
            type="number"
            min={1}
            max={365}
            placeholder="7"
          />
        </Field>
        <Field
          id="vps-netmodes"
          label="Réseau proposé au client"
          hint="Les réseaux sont définis dans l'IPAM"
        >
          <select
            id="vps-netmodes"
            name="networkModes"
            defaultValue="dhcp"
            className={selectClass}
          >
            <option value="dhcp">DHCP uniquement</option>
            <option value="static">IP statique uniquement</option>
            <option value="both">DHCP ou IP statique</option>
          </select>
        </Field>
        <Field
          id="vps-snaps"
          label="Snapshots manuels par VPS"
          hint="0 = désactivés"
        >
          <Input
            id="vps-snaps"
            name="snapshotLimit"
            type="number"
            min={0}
            max={50}
            defaultValue={3}
            required
          />
        </Field>
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && <p className="text-sm text-green-600">Offre créée.</p>}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer l'offre"}
        </Button>
      </div>
    </form>
  )
}

"use client"

import { useActionState, useState, useTransition } from "react"
import Link from "next/link"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  addAddressAction,
  addressOperation,
  assignAddressAction,
  createNetworkAction,
  deleteNetworkAction,
  detectConflictsAction,
  generateAddressesAction,
  setNetworkActiveAction,
} from "@/lib/ipam/actions"

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

export function NetworkForm({
  nodes,
  bridges,
}: {
  nodes: string[]
  bridges: string[]
}) {
  const [state, action, pending] = useActionState(
    createNetworkAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Nom">
          <Input name="name" placeholder="Public-A" required />
        </Field>
        <Field label="CIDR" hint="Adresse du réseau, ex. 203.0.113.0/24">
          <Input name="cidr" placeholder="203.0.113.0/24" required />
        </Field>
        <Field label="Passerelle">
          <Input name="gateway" placeholder="203.0.113.1" />
        </Field>
        <Field label="Serveurs DNS" hint="Séparés par des virgules">
          <Input name="dns" placeholder="1.1.1.1, 9.9.9.9" />
        </Field>
        <Field label="VLAN (facultatif)">
          <Input name="vlan" type="number" min={1} max={4094} />
        </Field>
        <Field label="Bridge Proxmox" hint="Vide = tous les ponts">
          <Input name="bridge" list="ipam-bridges" placeholder="vmbr0" />
          <datalist id="ipam-bridges">
            {bridges.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
        <Field label="Nœud" hint="Vide = tous les nœuds">
          <Input name="node" list="ipam-nodes" />
          <datalist id="ipam-nodes">
            {nodes.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
        <Field label="Début de plage" hint="Vide = première adresse utilisable">
          <Input name="rangeStart" />
        </Field>
        <Field label="Fin de plage" hint="Vide = dernière adresse utilisable">
          <Input name="rangeEnd" />
        </Field>
        <Field label="Mode d'attribution">
          <select name="mode" defaultValue="static" className={selectClass}>
            <option value="static">IP statique</option>
            <option value="dhcp">DHCP</option>
            <option value="both">DHCP et statique</option>
          </select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-2">
          <Field label="Notes internes">
            <Input name="notes" maxLength={500} />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="dhcpAvailable" />
          Un serveur DHCP est opérationnel sur ce réseau
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="clientAssignable" />
          Proposer ce réseau aux clients à la commande
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="allowOverlap" />
          Chevauchement documenté (réseau isolé, VLAN distinct…)
        </label>
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          Réseau créé. {state.notice}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer le réseau"}
        </Button>
      </div>
    </form>
  )
}

export function AddAddressForm({
  networks,
}: {
  networks: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState(addAddressAction, undefined)
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Réseau">
        <select name="networkId" required className={selectClass}>
          {networks.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Adresse">
        <Input name="address" placeholder="203.0.113.25" required />
      </Field>
      <Button type="submit" disabled={pending || networks.length === 0}>
        {pending ? "…" : "Ajouter"}
      </Button>
      {state?.error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="basis-full text-xs text-muted-foreground">
          Adresse ajoutée.
        </p>
      )}
    </form>
  )
}

export function NetworkActions({
  networkId,
  name,
  active,
}: {
  networkId: string
  name: string
  active: boolean
}) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const run = (
    fn: () => Promise<{ error?: string; notice?: string } | undefined>
  ) =>
    start(async () => {
      setMsg(null)
      const r = await fn()
      setMsg(r?.error ?? r?.notice ?? null)
    })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="xs"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => generateAddressesAction(networkId))}
      >
        Générer les adresses
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => setNetworkActiveAction(networkId, !active))}
      >
        {active ? "Désactiver" : "Activer"}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        className="text-destructive"
        disabled={pending}
        onClick={() => setConfirmDelete(true)}
      >
        Supprimer
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      <ConfirmDialog
        open={confirmDelete}
        title={`Supprimer le réseau « ${name} » ?`}
        description="Refusé si des adresses sont encore attribuées ou réservées, ou si des VPS l'utilisent. Les adresses disponibles seront supprimées."
        confirmLabel="Supprimer"
        destructive
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          run(async () => {
            const r = await deleteNetworkAction(networkId)
            setConfirmDelete(false)
            return r
          })
        }
      />
    </div>
  )
}

export function AddressActions({
  addressId,
  status,
  historyHref,
  servers,
}: {
  addressId: string
  status: "available" | "reserved" | "assigned" | "disabled" | "conflict"
  historyHref: string
  servers: { id: string; label: string }[]
}) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [dialog, setDialog] = useState<"reserve" | "disable" | "assign" | null>(
    null
  )
  const [reason, setReason] = useState("")
  const [serverId, setServerId] = useState(servers[0]?.id ?? "")

  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setMsg(null)
      const r = await fn()
      if (r?.error) setMsg(r.error)
      else setDialog(null)
    })

  const op = (o: Parameters<typeof addressOperation>[1]) =>
    run(() => addressOperation(addressId, o, reason))

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {status === "available" && (
        <>
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => setDialog("reserve")}
          >
            Réserver
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => setDialog("assign")}
          >
            Attribuer
          </Button>
        </>
      )}
      {status === "reserved" && (
        <>
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => op("release")}
          >
            Libérer
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => setDialog("assign")}
          >
            Attribuer
          </Button>
        </>
      )}
      {status === "assigned" && (
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => op("release")}
        >
          Libérer
        </Button>
      )}
      {status === "disabled" && (
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => op("enable")}
        >
          Réactiver
        </Button>
      )}
      {status === "conflict" && (
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => op("resolve")}
        >
          Marquer résolu
        </Button>
      )}
      {(status === "available" || status === "reserved") && (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => setDialog("disable")}
        >
          Désactiver
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        nativeButton={false}
        render={<Link href={historyHref} />}
      >
        Historique
      </Button>
      {msg && (
        <span
          role="alert"
          className="basis-full text-right text-xs text-destructive"
        >
          {msg}
        </span>
      )}

      <ConfirmDialog
        open={dialog === "reserve" || dialog === "disable"}
        title={
          dialog === "reserve" ? "Réserver l'adresse" : "Désactiver l'adresse"
        }
        description={
          <label className="mt-1 flex flex-col gap-1.5">
            <span>Motif</span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Ex. réservé pour le client X"
            />
          </label>
        }
        confirmLabel={dialog === "reserve" ? "Réserver" : "Désactiver"}
        pending={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => op(dialog === "reserve" ? "reserve" : "disable")}
      />
      <ConfirmDialog
        open={dialog === "assign"}
        title="Attribuer à un VPS"
        description={
          servers.length === 0 ? (
            "Aucun VPS."
          ) : (
            <select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className={selectClass}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )
        }
        confirmLabel="Attribuer"
        pending={pending || servers.length === 0}
        onCancel={() => setDialog(null)}
        onConfirm={() => run(() => assignAddressAction(addressId, serverId))}
      />
    </div>
  )
}

export function DetectConflictsButton() {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await detectConflictsAction()
            setMsg(r?.error ?? r?.notice ?? null)
          })
        }
      >
        {pending ? "Analyse…" : "Détecter les conflits"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  )
}

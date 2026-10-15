"use client"

import { useActionState, useState, useTransition } from "react"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createPermissionAction,
  createRoleAction,
  deletePermissionAction,
  deleteRoleAction,
  setUserRoleAction,
  updateRolePermissionsAction,
} from "@/lib/roles/actions"

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

type Perm = { key: string; label: string; isSystem: boolean }

export function CreateRoleForm({ permissions }: { permissions: Perm[] }) {
  const [state, action, pending] = useActionState(createRoleAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Nom du rôle</span>
          <Input name="name" required minLength={3} maxLength={60} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Description</span>
          <Input name="description" maxLength={200} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Permissions</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {permissions.map((p) => (
            <label key={p.key} className="flex items-start gap-2">
              <input
                type="checkbox"
                name="permissions"
                value={p.key}
                className="mt-1"
              />
              <span>
                {p.label}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {p.key}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
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
          {pending ? "Création…" : "Créer le rôle"}
        </Button>
      </div>
    </form>
  )
}

export function RoleEditor({
  roleId,
  name,
  isSystem,
  assigned,
  current,
  permissions,
}: {
  roleId: string
  name: string
  isSystem: boolean
  assigned: number
  current: string[]
  permissions: Perm[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(current))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty =
    selected.size !== current.length || current.some((k) => !selected.has(k))

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {permissions.map((p) => (
          <label key={p.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.has(p.key)}
              onChange={(e) => {
                const next = new Set(selected)
                if (e.target.checked) next.add(p.key)
                else next.delete(p.key)
                setSelected(next)
              }}
            />
            <span>
              {p.label}{" "}
              <span className="font-mono text-xs text-muted-foreground">
                {p.key}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const r = await updateRolePermissionsAction(roleId, [...selected])
              setMsg(
                r?.error
                  ? { ok: false, text: r.error }
                  : { ok: true, text: "Permissions enregistrées." }
              )
            })
          }
        >
          Enregistrer
        </Button>
        {!isSystem && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
          >
            Supprimer le rôle
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {assigned} membre(s)
        </span>
        {msg && (
          <span
            role={msg.ok ? "status" : "alert"}
            className={`text-xs ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {msg.text}
          </span>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={`Supprimer le rôle « ${name} » ?`}
        description="Refusé si des membres du support l'utilisent encore."
        confirmLabel="Supprimer"
        destructive
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          start(async () => {
            const r = await deleteRoleAction(roleId)
            setConfirmDelete(false)
            if (r?.error) setMsg({ ok: false, text: r.error })
          })
        }
      />
    </div>
  )
}

export function CreatePermissionForm() {
  const [state, action, pending] = useActionState(
    createPermissionAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Clé</span>
        <Input
          name="key"
          placeholder="billing.refund"
          className="w-52 font-mono"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Libellé</span>
        <Input name="label" className="w-60" required />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Description</span>
        <Input name="description" className="w-72" maxLength={200} />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Créer la permission"}
      </Button>
      {state?.error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="basis-full text-xs text-muted-foreground">
          {state.notice}
        </p>
      )}
    </form>
  )
}

export function DeletePermissionButton({ permKey }: { permKey: string }) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        className="text-destructive"
        onClick={() => setOpen(true)}
      >
        Supprimer
      </Button>
      <ConfirmDialog
        open={open}
        title={`Supprimer « ${permKey} » ?`}
        description="La permission est retirée de tous les rôles."
        confirmLabel="Supprimer"
        destructive
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            await deletePermissionAction(permKey)
            setOpen(false)
          })
        }
      />
    </>
  )
}

export function UserRoleForm({
  userId,
  role,
  roleId,
  roles,
  isSelf,
}: {
  userId: string
  role: "user" | "support" | "admin"
  roleId: string | null
  roles: { id: string; name: string }[]
  isSelf: boolean
}) {
  const [r, setR] = useState(role)
  const [rid, setRid] = useState(roleId ?? "")
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  const changed = r !== role || (r === "support" && (rid || null) !== roleId)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Rôle"
        value={r}
        disabled={isSelf || pending}
        onChange={(e) => setR(e.target.value as typeof r)}
        className={`${selectClass} w-36`}
      >
        <option value="user">Client</option>
        <option value="support">Support</option>
        <option value="admin">Administrateur</option>
      </select>
      {r === "support" && (
        <select
          aria-label="Rôle personnalisé"
          value={rid}
          disabled={isSelf || pending}
          onChange={(e) => setRid(e.target.value)}
          className={`${selectClass} w-44`}
        >
          <option value="">Permissions par défaut</option>
          {roles.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )}
      <Button
        size="xs"
        variant="outline"
        disabled={isSelf || pending || !changed}
        onClick={() => setConfirm(true)}
      >
        Appliquer
      </Button>
      {isSelf && (
        <span className="text-xs text-muted-foreground">(ton compte)</span>
      )}
      {msg && (
        <span role="alert" className="text-xs text-destructive">
          {msg}
        </span>
      )}
      <ConfirmDialog
        open={confirm}
        title="Modifier le rôle ?"
        description="Les sessions de ce compte seront fermées : la personne devra se reconnecter."
        confirmLabel="Modifier le rôle"
        destructive={r === "admin"}
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            const res = await setUserRoleAction(userId, {
              role: r,
              roleId: r === "support" ? rid || null : null,
            })
            setConfirm(false)
            setMsg(res?.error ?? null)
          })
        }
      />
    </div>
  )
}

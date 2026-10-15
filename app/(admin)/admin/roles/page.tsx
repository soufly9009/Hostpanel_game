import { count, eq } from "drizzle-orm"

import {
  CreatePermissionForm,
  CreateRoleForm,
  DeletePermissionButton,
  RoleEditor,
} from "@/components/role-controls"
import { PageHeader, Section, StatusBadge } from "@/components/kit"
import { ensureRbacSeed } from "@/lib/auth/permissions"
import { DEFAULT_SUPPORT } from "@/lib/auth/roles"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Rôles et permissions" }
export const dynamic = "force-dynamic"

export default async function RolesPage() {
  await ensureRbacSeed()

  const [roles, perms, assignments] = await Promise.all([
    db.select().from(schema.roles).orderBy(schema.roles.name),
    db.select().from(schema.permissions).orderBy(schema.permissions.key),
    db
      .select({ roleId: schema.users.roleId, n: count() })
      .from(schema.users)
      .where(eq(schema.users.role, "support"))
      .groupBy(schema.users.roleId),
  ])

  const assigned = new Map(assignments.map((a) => [a.roleId, a.n]))
  const permList = perms.map((p) => ({
    key: p.key,
    label: p.label,
    isSystem: p.isSystem,
  }))

  return (
    <>
      <PageHeader
        title="Rôles et permissions"
        description="L'administrateur a toutes les permissions. Un membre du support reçoit celles de son rôle ; sans rôle personnalisé, les permissions par défaut s'appliquent."
      />

      <Section
        title="Permissions par défaut du support"
        description="S'appliquent aux membres du support sans rôle personnalisé."
      >
        <ul className="flex flex-wrap gap-2">
          {DEFAULT_SUPPORT.map((k) => (
            <li key={k}>
              <StatusBadge tone="neutral">
                <span className="font-mono">{k}</span>
              </StatusBadge>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Rôles (${roles.length})`}>
        <ul className="divide-y">
          {roles.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 py-4">
              <div>
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {r.name}
                  {r.isSystem && <StatusBadge tone="info">Système</StatusBadge>}
                </p>
                {r.description && (
                  <p className="text-xs text-muted-foreground">
                    {r.description}
                  </p>
                )}
              </div>
              <RoleEditor
                roleId={r.id}
                name={r.name}
                isSystem={r.isSystem}
                assigned={assigned.get(r.id) ?? 0}
                current={r.permissions}
                permissions={permList}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Nouveau rôle">
        <CreateRoleForm permissions={permList} />
      </Section>

      <Section
        title={`Permissions (${perms.length})`}
        description="Les permissions « système » sont vérifiées par le panel. Une permission personnalisée n'a d'effet que si du code ou une intégration la vérifie."
      >
        <ul className="divide-y text-sm">
          {perms.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-mono text-xs">{p.key}</span>
              <span>{p.label}</span>
              {p.isSystem ? (
                <StatusBadge tone="info">Système</StatusBadge>
              ) : (
                <StatusBadge tone="warning">Personnalisée</StatusBadge>
              )}
              {p.description && (
                <span className="text-xs text-muted-foreground">
                  {p.description}
                </span>
              )}
              {!p.isSystem && (
                <span className="ml-auto">
                  <DeletePermissionButton permKey={p.key} />
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-3 text-sm font-medium">Créer une permission</h3>
          <CreatePermissionForm />
        </div>
      </Section>
    </>
  )
}

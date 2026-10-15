import { count, desc, eq } from "drizzle-orm"

import { UserRoleForm } from "@/components/role-controls"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { setServerLimit } from "@/lib/admin/actions"
import { requireAdmin } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Clients" }
export const dynamic = "force-dynamic"

export default async function AdminUsersPage() {
  const me = await requireAdmin()
  const customRoles = await db
    .select({ id: schema.roles.id, name: schema.roles.name })
    .from(schema.roles)
    .orderBy(schema.roles.name)
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      roleId: schema.users.roleId,
      serverLimit: schema.users.serverLimit,
      servers: count(schema.servers.id),
    })
    .from(schema.users)
    .leftJoin(schema.servers, eq(schema.servers.userId, schema.users.id))
    .groupBy(schema.users.id)
    .orderBy(desc(schema.users.createdAt))

  return (
    <>
      <h1 className="text-xl font-semibold">Clients</h1>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Client</th>
              <th className="p-3 font-medium">Rôle</th>
              <th className="p-3 font-medium">Serveurs</th>
              <th className="p-3 font-medium">Limite</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="p-3">
                  <p className="font-medium">{u.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </td>
                <td className="p-3">
                  <UserRoleForm
                    userId={u.id}
                    role={u.role}
                    roleId={u.roleId}
                    roles={customRoles}
                    isSelf={u.id === me.id}
                  />
                </td>
                <td className="p-3">{u.servers}</td>
                <td className="p-3">
                  <form
                    action={setServerLimit.bind(null, u.id)}
                    className="flex max-w-40 gap-2"
                  >
                    <Input
                      name="serverLimit"
                      type="number"
                      min={0}
                      max={1000}
                      defaultValue={u.serverLimit}
                      className="h-8 w-20"
                    />
                    <Button size="sm" variant="outline" type="submit">
                      OK
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

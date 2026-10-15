import { desc, eq } from "drizzle-orm"
import Link from "next/link"

import { ServerActions } from "@/components/admin-row-actions"
import { db, schema } from "@/lib/db"
import { isPast } from "@/lib/expiry"

export const metadata = { title: "VPS" }
export const dynamic = "force-dynamic"

export default async function AdminServersPage() {
  const rows = await db
    .select({
      id: schema.servers.id,
      name: schema.servers.name,
      address: schema.servers.address,
      ipv6: schema.servers.ipv6,
      suspended: schema.servers.suspended,
      suspendReason: schema.servers.suspendReason,
      expiresAt: schema.servers.expiresAt,
      virt: schema.servers.virt,
      node: schema.servers.node,
      vmid: schema.servers.vmid,
      owner: schema.users.email,
      plan: schema.plans.name,
    })
    .from(schema.servers)
    .innerJoin(schema.users, eq(schema.users.id, schema.servers.userId))
    .leftJoin(schema.plans, eq(schema.plans.id, schema.servers.planId))
    .orderBy(desc(schema.servers.createdAt))

  return (
    <>
      <h1 className="text-xl font-semibold">VPS</h1>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">VPS</th>
              <th className="p-3 font-medium">Client</th>
              <th className="p-3 font-medium">Offre</th>
              <th className="p-3 font-medium">Proxmox</th>
              <th className="p-3 font-medium">Adresse</th>
              <th className="p-3 font-medium">Échéance</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="p-3 font-medium">
                  <Link
                    href={`/servers/${s.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {s.name}
                  </Link>
                  {s.suspended && (
                    <span className="ml-2 text-xs text-destructive">
                      suspendu
                    </span>
                  )}
                </td>
                <td className="p-3">{s.owner}</td>
                <td className="p-3">{s.plan ?? "—"}</td>
                <td className="p-3 font-mono text-xs">
                  {s.virt}/{s.vmid} · {s.node}
                </td>
                <td className="p-3 font-mono text-xs">
                  <p>{s.address ?? "—"}</p>
                  {s.ipv6 && <p className="break-all">{s.ipv6}</p>}
                </td>
                <td className="p-3 text-xs">
                  {s.expiresAt ? (
                    <span
                      className={isPast(s.expiresAt) ? "text-destructive" : ""}
                    >
                      {s.expiresAt.toLocaleDateString("fr-FR")}
                    </span>
                  ) : (
                    "—"
                  )}
                  {s.suspendReason === "expired" && (
                    <span className="ml-1 text-destructive">expiré</span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex justify-end">
                    <ServerActions serverId={s.id} suspended={s.suspended} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-4 text-center text-muted-foreground"
                >
                  Aucun VPS.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

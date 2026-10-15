import { desc } from "drizzle-orm"

import { PlanActions } from "@/components/admin-row-actions"
import { VpsPlanForm } from "@/components/vps-plan-form"
import { db, schema } from "@/lib/db"
import { env, proxmoxConfigured } from "@/lib/env"
import { formatPrice } from "@/lib/format"
import { planSpecs } from "@/lib/plans"
import { listNodes } from "@/lib/proxmox/client"

export const metadata = { title: "Offres" }
export const dynamic = "force-dynamic"

async function loadNodes() {
  if (!proxmoxConfigured) {
    return {
      error:
        "Proxmox n'est pas configuré : renseigne PROXMOX_URL, PROXMOX_TOKEN_ID et PROXMOX_TOKEN_SECRET.",
    } as const
  }
  try {
    const nodes = await listNodes()
    return { nodes: nodes.map((n) => n.node) } as const
  } catch (e) {
    return {
      error: `Proxmox : ${e instanceof Error ? e.message : "injoignable"}`,
    } as const
  }
}

export default async function AdminPlansPage() {
  const [plans, pve] = await Promise.all([
    db.select().from(schema.plans).orderBy(desc(schema.plans.createdAt)),
    loadNodes(),
  ])

  return (
    <>
      <h1 className="text-xl font-semibold">Offres</h1>

      {"error" in pve ? (
        <>
          <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
            {pve.error}
          </p>
          {/* Le formulaire reste utilisable : nœud et template saisis à la main. */}
          {proxmoxConfigured && <VpsPlanForm nodes={[]} />}
        </>
      ) : (
        <VpsPlanForm nodes={pve.nodes} />
      )}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Offre</th>
              <th className="p-3 font-medium">Ressources</th>
              <th className="p-3 font-medium">Prix</th>
              <th className="p-3 font-medium">Période · snapshots</th>
              <th className="p-3 font-medium">Statut</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {plans.map((p) => (
              <tr key={p.id}>
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3 text-muted-foreground">
                  {planSpecs(p).join(" · ")}
                </td>
                <td className="p-3">{formatPrice(p.priceCents)}</td>
                <td className="p-3 text-muted-foreground">
                  {p.periodDays ?? env.RENEW_PERIOD_DAYS} j ·{" "}
                  {p.snapshotLimit > 0
                    ? `${p.snapshotLimit} snap.`
                    : "sans snapshot"}
                </td>
                <td className="p-3">{p.isActive ? "Active" : "Désactivée"}</td>
                <td className="p-3">
                  <div className="flex justify-end">
                    <PlanActions planId={p.id} isActive={p.isActive} />
                  </div>
                </td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="p-4 text-center text-muted-foreground"
                >
                  Aucune offre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

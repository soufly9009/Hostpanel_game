import Link from "next/link"
import { count, eq } from "drizzle-orm"

import { CreateServerForm } from "@/components/create-server-form"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { formatPrice } from "@/lib/format"
import { planSpecs } from "@/lib/plans"

export const metadata = { title: "Nouveau VPS" }
export const dynamic = "force-dynamic"

export default async function NewServerPage() {
  const user = await requireUser()

  const [plans, [{ owned }]] = await Promise.all([
    db.select().from(schema.plans).where(eq(schema.plans.isActive, true)),
    db
      .select({ owned: count() })
      .from(schema.servers)
      .where(eq(schema.servers.userId, user.id)),
  ])

  const limitReached = user.role !== "admin" && owned >= user.serverLimit

  return (
    <>
      <h1 className="text-xl font-semibold">Nouveau VPS</h1>

      {limitReached ? (
        <p className="rounded-xl border p-4 text-sm">
          Tu as atteint ta limite de {user.serverLimit} VPS. Supprime-en un ou
          contacte le support pour augmenter ta limite.{" "}
          <Link href="/dashboard" className="underline underline-offset-4">
            Retour
          </Link>
        </p>
      ) : plans.length === 0 ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          Aucune offre n&apos;est disponible pour le moment.
        </p>
      ) : (
        <CreateServerForm
          plans={plans.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: formatPrice(p.priceCents),
            specs: planSpecs(p),
            lxc: p.proxmox.virt === "lxc",
          }))}
        />
      )}
    </>
  )
}

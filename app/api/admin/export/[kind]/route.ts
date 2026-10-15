import { desc, eq } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { getCurrentUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

export const dynamic = "force-dynamic"

/** CSV compatible Excel (FR) : séparateur « ; », BOM UTF-8, décimales « , ». */
function csv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v)
    // Neutralise les formules (=, +, -, @) à l'ouverture dans un tableur.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n")
}

const amount = (c: number) => (c / 100).toFixed(2).replace(".", ",")
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "")

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> }
) {
  const user = await getCurrentUser()
  if (user?.role !== "admin") return new Response("Not found", { status: 404 })
  const { kind } = await params
  let rows: (string | number | null)[][]

  if (kind === "invoices") {
    const list = await db
      .select()
      .from(schema.invoices)
      .orderBy(desc(schema.invoices.issuedAt))
    rows = [
      [
        "numero",
        "type",
        "statut",
        "date",
        "echeance",
        "reglee_le",
        "client",
        "societe",
        "tva_client",
        "ht",
        "taxe",
        "ttc",
        "taux",
        "devise",
      ],
      ...list.map((i) => [
        i.number,
        i.type,
        i.status,
        day(i.issuedAt),
        day(i.dueAt),
        day(i.paidAt),
        i.buyer.name,
        i.buyer.company ?? "",
        i.buyer.vatNumber ?? "",
        amount(i.subtotalCents),
        amount(i.taxCents),
        amount(i.totalCents),
        (i.taxRateBp / 100).toString().replace(".", ","),
        i.currency,
      ]),
    ]
  } else if (kind === "clients") {
    const list = await db
      .select({ u: schema.users, p: schema.billingProfiles })
      .from(schema.users)
      .leftJoin(
        schema.billingProfiles,
        eq(schema.billingProfiles.userId, schema.users.id)
      )
      .orderBy(desc(schema.users.createdAt))
    rows = [
      [
        "id",
        "email",
        "nom",
        "role",
        "inscrit_le",
        "solde_credits",
        "societe",
        "ville",
        "pays",
        "2fa",
      ],
      ...list.map(({ u, p }) => [
        u.id,
        u.email,
        u.name,
        u.role,
        day(u.createdAt),
        amount(u.balanceCents),
        p?.company ?? "",
        p?.city ?? "",
        p?.country ?? "",
        u.totpEnabledAt ? "oui" : "non",
      ]),
    ]
  } else if (kind === "transactions") {
    const list = await db
      .select({ t: schema.walletTransactions, email: schema.users.email })
      .from(schema.walletTransactions)
      .leftJoin(
        schema.users,
        eq(schema.users.id, schema.walletTransactions.userId)
      )
      .orderBy(desc(schema.walletTransactions.createdAt))
    rows = [
      ["date", "client", "type", "libelle", "montant", "solde_apres", "auteur"],
      ...list.map(({ t, email }) => [
        t.createdAt.toISOString(),
        email,
        t.kind,
        t.description,
        amount(t.amountCents),
        amount(t.balanceAfterCents),
        t.actor,
      ]),
    ]
  } else {
    return new Response("Not found", { status: 404 })
  }

  await logActivity(user, `Export CSV : ${kind}`, { type: "account" })
  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-${day(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}

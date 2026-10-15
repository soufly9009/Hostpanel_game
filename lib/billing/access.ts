import "server-only"

import { asc, eq } from "drizzle-orm"

import { can } from "@/lib/auth/permissions"
import { isStaffRole } from "@/lib/auth/roles"
import { getCurrentUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

/**
 * Facture visible par l'utilisateur connecté : la sienne, ou n'importe
 * laquelle pour le personnel ayant `billing.view`. null sinon (→ 404).
 */
export async function getViewableInvoice(id: string) {
  const user = await getCurrentUser()
  if (!user || typeof id !== "string" || id.length > 64) return null
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
  if (!invoice) return null

  const staff = isStaffRole(user.role)
  const canView = staff && (await can(user, "billing.view"))
  const canManage = staff && (await can(user, "billing.manage"))
  if (invoice.userId !== user.id && !canView) return null

  const [items, payments, related] = await Promise.all([
    db
      .select()
      .from(schema.invoiceItems)
      .where(eq(schema.invoiceItems.invoiceId, invoice.id)),
    db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.invoiceId, invoice.id))
      .orderBy(asc(schema.payments.createdAt)),
    db
      .select({
        id: schema.invoices.id,
        number: schema.invoices.number,
        type: schema.invoices.type,
      })
      .from(schema.invoices)
      .where(
        invoice.relatedInvoiceId
          ? eq(schema.invoices.id, invoice.relatedInvoiceId)
          : eq(schema.invoices.relatedInvoiceId, invoice.id)
      ),
  ])
  return {
    user,
    invoice,
    items,
    payments,
    related,
    isOwner: invoice.userId === user.id,
    canManage,
  }
}

import Link from "next/link"
import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { PrinterIcon } from "lucide-react"

import {
  CancelInvoiceForm,
  PayWithCreditsButton,
  RecordPaymentForm,
} from "@/components/billing-controls"
import { InvoiceDocument } from "@/components/invoice-document"
import { PageHeader, Section } from "@/components/kit"
import { LegalBody } from "@/components/legal-body"
import { Button } from "@/components/ui/button"
import { getViewableInvoice } from "@/lib/billing/access"
import { formatMoney } from "@/lib/billing/money"
import { getBillingSettings } from "@/lib/billing/settings"
import { db, schema } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const v = await getViewableInvoice(id)
  if (!v) notFound()
  const { invoice: inv, items, payments, related, isOwner, canManage } = v
  const settings = await getBillingSettings()
  const unpaid = inv.status === "unpaid" && inv.type === "invoice"

  const [owner] = inv.userId
    ? await db
        .select({
          balance: schema.users.balanceCents,
          email: schema.users.email,
        })
        .from(schema.users)
        .where(eq(schema.users.id, inv.userId))
    : []

  return (
    <>
      <PageHeader
        title={`${inv.type === "credit_note" ? "Avoir" : "Facture"} ${inv.number}`}
        description={
          <>
            <Link
              className="underline"
              href={isOwner ? "/invoices" : "/support/invoices"}
            >
              {isOwner ? "Mes factures" : "Toutes les factures"}
            </Link>
            {!isOwner && owner && (
              <>
                {" · "}
                <Link className="underline" href={`/admin/users/${inv.userId}`}>
                  {owner.email}
                </Link>
              </>
            )}
          </>
        }
        actions={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/print/invoices/${inv.id}`} target="_blank" />}
          >
            <PrinterIcon /> Imprimer / PDF
          </Button>
        }
      />

      {unpaid && isOwner && (
        <Section
          title={`Régler ${formatMoney(inv.totalCents, inv.currency)}`}
          description={`Échéance : ${inv.dueAt.toLocaleDateString("fr-FR", { dateStyle: "long" })}. Le service lié est prolongé dès réception du paiement.`}
        >
          <div className="flex flex-col gap-6">
            {settings.allowCreditPayment && (
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  Solde disponible :{" "}
                  <strong>
                    {formatMoney(owner?.balance ?? 0, inv.currency)}
                  </strong>
                </p>
                {(owner?.balance ?? 0) >= inv.totalCents ? (
                  <PayWithCreditsButton
                    invoiceId={inv.id}
                    label="Payer avec mon solde"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Solde insuffisant.{" "}
                    <Link className="underline" href="/wallet">
                      Ajouter des crédits
                    </Link>
                  </p>
                )}
              </div>
            )}
            {settings.bankTransferEnabled && settings.paymentInstructions && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">Virement bancaire</p>
                <div className="text-muted-foreground">
                  <LegalBody body={settings.paymentInstructions} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Indique la référence{" "}
                  <strong className="font-mono">{inv.number}</strong>. Le
                  paiement est validé à réception.
                </p>
              </div>
            )}
            {!settings.allowCreditPayment && !settings.bankTransferEnabled && (
              <p className="text-sm text-muted-foreground">
                Contacte le support pour régler cette facture.
              </p>
            )}
          </div>
        </Section>
      )}

      <InvoiceDocument
        invoice={inv}
        items={items}
        payments={payments}
        relatedNumber={related.map((r) => r.number).join(", ") || null}
      />

      {canManage && inv.type === "invoice" && (
        <Section title="Gestion (personnel)">
          <div className="flex flex-col gap-6">
            {unpaid && <RecordPaymentForm invoiceId={inv.id} />}
            {(inv.status === "unpaid" || inv.status === "paid") && (
              <CancelInvoiceForm
                invoiceId={inv.id}
                paid={inv.status === "paid"}
              />
            )}
          </div>
        </Section>
      )}
    </>
  )
}

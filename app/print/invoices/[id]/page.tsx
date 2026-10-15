import { notFound } from "next/navigation"

import { InvoiceDocument } from "@/components/invoice-document"
import { PrintButton } from "@/components/print-button"
import { getViewableInvoice } from "@/lib/billing/access"

export const dynamic = "force-dynamic"
export const metadata = { robots: { index: false } }

export default async function PrintInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const v = await getViewableInvoice(id)
  if (!v) notFound()
  return (
    <>
      <div className="mb-6 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <InvoiceDocument
        invoice={v.invoice}
        items={v.items}
        payments={v.payments}
        relatedNumber={v.related.map((r) => r.number).join(", ") || null}
      />
    </>
  )
}

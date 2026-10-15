import Link from "next/link"

import { BillingSettingsForm } from "@/components/billing-controls"
import { ErrorState, PageHeader, Section } from "@/components/kit"
import { getBillingSettings, missingSellerFields } from "@/lib/billing/settings"

export const metadata = { title: "Facturation" }
export const dynamic = "force-dynamic"

export default async function AdminBillingPage() {
  const settings = await getBillingSettings()
  const missing = missingSellerFields(settings)

  return (
    <>
      <PageHeader
        title="Facturation"
        description={
          <>
            Factures numérotées sans rupture, avoirs, rappels et paiement
            automatique par le solde.{" "}
            <Link className="underline" href="/support/invoices">
              Voir les factures
            </Link>
          </>
        }
      />
      {settings.mode === "invoices" && missing.length > 0 && (
        <ErrorState
          title="Mentions obligatoires manquantes"
          message={`Complète : ${missing.join(", ")}. Les factures émises figent ces informations.`}
        />
      )}
      <Section
        title="Avant d'encaisser de l'argent réel"
        description="Le panel prépare des factures conformes, mais ne traite encore aucun paiement bancaire : un paiement reçu (virement…) se constate à la main sur la facture."
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Renseigne toutes les mentions du vendeur ; fais valider tes CGV, ta
            TVA et tes mentions par un professionnel.
          </li>
          <li>
            Les crédits sont présentés comme sans valeur monétaire dans les
            conditions : si tu les fais acheter, adapte « Conditions des crédits
            ».
          </li>
          <li>
            Une passerelle de paiement en ligne (carte, PayPal) n&apos;est pas
            encore branchée : les moyens « card » et « paypal » existent pour la
            constater.
          </li>
          <li>
            Les factures sont conservées 10 ans, même après suppression du
            compte client.
          </li>
        </ul>
      </Section>
      <Section title="Réglages">
        <BillingSettingsForm settings={settings} />
      </Section>
    </>
  )
}

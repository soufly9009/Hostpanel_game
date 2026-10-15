"use client"

import { useActionState, useState, useTransition } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  adminSaveBillingProfileAction,
  cancelInvoiceAction,
  createCustomInvoiceAction,
  payWithCreditsAction,
  recordPaymentAction,
  saveBillingProfileAction,
  saveBillingSettingsAction,
  type BillingState,
} from "@/lib/billing/actions"

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const textareaClass =
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

function Feedback({ state }: { state: BillingState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    )
  }
  if (state?.ok && state.notice) {
    return (
      <p
        role="status"
        className="text-sm text-emerald-700 dark:text-emerald-400"
      >
        {state.notice}
      </p>
    )
  }
  return null
}

function Field({
  label,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm ${className ?? ""}`}>
      <span className="font-medium">{label}</span>
      <Input {...props} />
    </label>
  )
}

/* ───────────── Client ───────────── */

export function PayWithCreditsButton({
  invoiceId,
  label,
}: {
  invoiceId: string
  label: string
}) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<BillingState>(undefined)
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => setState(await payWithCreditsAction(invoiceId)))
          }
        >
          {pending ? "Paiement…" : label}
        </Button>
      </div>
      <Feedback state={state} />
    </div>
  )
}

type Profile = {
  fullName: string | null
  company: string | null
  address1: string | null
  address2: string | null
  postalCode: string | null
  city: string | null
  country: string
  vatNumber: string | null
  phone: string | null
  autoPayWithCredits: boolean
}

export function BillingProfileForm({
  profile,
  userId,
}: {
  profile: Profile | null
  /** Renseigné : édition par un administrateur depuis la fiche client. */
  userId?: string
}) {
  const [state, action, pending] = useActionState(
    userId ? adminSaveBillingProfileAction : saveBillingProfileAction,
    undefined
  )
  const p = profile
  return (
    <form action={action} className="flex flex-col gap-3">
      {userId && <input type="hidden" name="userId" value={userId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Nom complet"
          name="fullName"
          defaultValue={p?.fullName ?? ""}
          required
          autoComplete="name"
        />
        <Field
          label="Société (facultatif)"
          name="company"
          defaultValue={p?.company ?? ""}
          autoComplete="organization"
        />
        <Field
          label="Adresse"
          name="address1"
          defaultValue={p?.address1 ?? ""}
          required
          autoComplete="address-line1"
        />
        <Field
          label="Complément"
          name="address2"
          defaultValue={p?.address2 ?? ""}
          autoComplete="address-line2"
        />
        <Field
          label="Code postal"
          name="postalCode"
          defaultValue={p?.postalCode ?? ""}
          required
          autoComplete="postal-code"
        />
        <Field
          label="Ville"
          name="city"
          defaultValue={p?.city ?? ""}
          required
          autoComplete="address-level2"
        />
        <Field
          label="Pays (code ISO, ex. FR)"
          name="country"
          defaultValue={p?.country ?? "FR"}
          required
          maxLength={2}
          className="uppercase"
        />
        <Field
          label="N° de TVA intracommunautaire (pro)"
          name="vatNumber"
          defaultValue={p?.vatNumber ?? ""}
        />
        <Field
          label="Téléphone"
          name="phone"
          defaultValue={p?.phone ?? ""}
          autoComplete="tel"
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="autoPayWithCredits"
          defaultChecked={p?.autoPayWithCredits ?? true}
          className="mt-1"
        />
        <span>
          Régler automatiquement mes factures avec mon solde de crédits
        </span>
      </label>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  )
}

/* ───────────── Personnel ───────────── */

export function RecordPaymentForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(
    recordPaymentAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Moyen</span>
          <select
            name="method"
            className={selectClass}
            defaultValue="bank_transfer"
          >
            <option value="bank_transfer">Virement bancaire</option>
            <option value="card">Carte bancaire</option>
            <option value="paypal">PayPal</option>
            <option value="manual">Autre (espèces, chèque…)</option>
          </select>
        </label>
        <Field
          label="Référence"
          name="reference"
          maxLength={120}
          className="w-48"
        />
        <Field label="Note" name="note" maxLength={300} className="flex-1" />
      </div>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Enregistrer le paiement intégral"}
        </Button>
      </div>
    </form>
  )
}

export function CancelInvoiceForm({
  invoiceId,
  paid,
}: {
  invoiceId: string
  paid: boolean
}) {
  const [state, action, pending] = useActionState(
    cancelInvoiceAction,
    undefined
  )
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <Button
        variant="outline"
        className="text-destructive"
        onClick={() => setOpen(true)}
      >
        {paid ? "Rembourser (avoir)" : "Annuler (avoir)"}
      </Button>
    )
  }
  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-3"
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <p className="text-sm text-muted-foreground">
        Une facture émise ne se supprime pas : un avoir du même montant est
        créé. Les services déjà prolongés ne sont pas modifiés.
      </p>
      <Field
        label="Motif (figurera sur l'avoir)"
        name="reason"
        required
        minLength={3}
        maxLength={300}
      />
      {paid && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="refundToCredits" />
          Recréditer le montant sur le solde du client
        </label>
      )}
      <Feedback state={state} />
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "…" : "Émettre l'avoir"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>
    </form>
  )
}

export function CustomInvoiceForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(
    createCustomInvoiceAction,
    undefined
  )
  const [rows, setRows] = useState([0])
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={userId} />
      {rows.map((r, i) => (
        <div key={r} className="flex flex-wrap items-end gap-2">
          <Field
            label={i === 0 ? "Désignation" : ""}
            aria-label="Désignation"
            name="description"
            required={i === 0}
            maxLength={200}
            className="min-w-60 flex-1"
          />
          <Field
            label={i === 0 ? "Qté" : ""}
            aria-label="Quantité"
            name="quantity"
            type="number"
            min={1}
            max={1000}
            defaultValue={1}
            className="w-20"
          />
          <Field
            label={i === 0 ? "Prix unitaire" : ""}
            aria-label="Prix unitaire"
            name="price"
            inputMode="decimal"
            placeholder="9,99"
            className="w-28"
          />
          {rows.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Retirer la ligne"
              onClick={() => setRows(rows.filter((x) => x !== r))}
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setRows([...rows, Math.max(...rows) + 1])}
        >
          <PlusIcon /> Ligne
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Field
          label="Échéance (jours)"
          name="dueDays"
          type="number"
          min={0}
          max={90}
          defaultValue={7}
          className="w-32"
        />
        <Field
          label="Note (sur la facture)"
          name="notes"
          maxLength={500}
          className="flex-1"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Les prix suivent le réglage « prix TTC / HT » de la facturation.
      </p>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Émettre la facture"}
        </Button>
      </div>
    </form>
  )
}

/* ───────────── Administration : réglages ───────────── */

type Settings = {
  mode: "off" | "invoices"
  currency: string
  taxRateBp: number
  taxLabel: string
  pricesIncludeTax: boolean
  taxExemptMention: string
  invoicePrefix: string
  creditNotePrefix: string
  orderDueDays: number
  renewalDaysBefore: number
  reminderDaysBefore: number
  allowCreditPayment: boolean
  bankTransferEnabled: boolean
  paymentInstructions: string
  latePenaltyMention: string
  seller: Record<
    | "name"
    | "legalForm"
    | "address1"
    | "address2"
    | "postalCode"
    | "city"
    | "country"
    | "siret"
    | "rcs"
    | "vatNumber"
    | "email",
    string
  >
}

export function BillingSettingsForm({ settings: s }: { settings: Settings }) {
  const [state, action, pending] = useActionState(
    saveBillingSettingsAction,
    undefined
  )
  const seller = (
    k: keyof Settings["seller"],
    label: string,
    required = false
  ) => (
    <Field
      label={label}
      name={`seller.${k}`}
      defaultValue={s.seller[k]}
      required={required}
    />
  )
  return (
    <form action={action} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Mode</legend>
        <select
          name="mode"
          defaultValue={s.mode}
          className={`${selectClass} max-w-md`}
        >
          <option value="off">
            Sans factures (crédits débités directement, si activé)
          </option>
          <option value="invoices">
            Factures (commandes et renouvellements facturés)
          </option>
        </select>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold sm:col-span-3">
          Vendeur (mentions obligatoires)
        </legend>
        {seller("name", "Raison sociale / nom", true)}
        {seller(
          "legalForm",
          "Forme et capital (ex. SAS au capital de 1 000 €)"
        )}
        {seller("email", "E-mail de facturation")}
        {seller("address1", "Adresse", true)}
        {seller("address2", "Complément")}
        {seller("postalCode", "Code postal", true)}
        {seller("city", "Ville", true)}
        {seller("country", "Pays")}
        {seller("siret", "SIREN / SIRET", true)}
        {seller("rcs", "RCS (ex. RCS Paris 123 456 789)")}
        {seller("vatNumber", "N° de TVA intracommunautaire")}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold sm:col-span-3">
          Taxe et numérotation
        </legend>
        <Field
          label="Taux (%)"
          name="taxRate"
          inputMode="decimal"
          defaultValue={String(s.taxRateBp / 100).replace(".", ",")}
        />
        <Field label="Libellé" name="taxLabel" defaultValue={s.taxLabel} />
        <Field
          label="Devise (ISO)"
          name="currency"
          defaultValue={s.currency}
          maxLength={3}
          className="uppercase"
        />
        <Field
          label="Mention d'exonération (taux 0)"
          name="taxExemptMention"
          defaultValue={s.taxExemptMention}
          placeholder="TVA non applicable, art. 293 B du CGI"
          className="sm:col-span-3"
        />
        <Field
          label="Préfixe des factures"
          name="invoicePrefix"
          defaultValue={s.invoicePrefix}
          maxLength={6}
          className="uppercase"
        />
        <Field
          label="Préfixe des avoirs"
          name="creditNotePrefix"
          defaultValue={s.creditNotePrefix}
          maxLength={6}
          className="uppercase"
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            name="pricesIncludeTax"
            defaultChecked={s.pricesIncludeTax}
          />
          Prix des offres saisis TTC
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold sm:col-span-3">
          Délais
        </legend>
        <Field
          label="Délai de paiement d'une commande (jours)"
          name="orderDueDays"
          type="number"
          min={0}
          max={60}
          defaultValue={s.orderDueDays}
        />
        <Field
          label="Facture de renouvellement (jours avant)"
          name="renewalDaysBefore"
          type="number"
          min={1}
          max={60}
          defaultValue={s.renewalDaysBefore}
        />
        <Field
          label="Rappel (jours avant l'échéance)"
          name="reminderDaysBefore"
          type="number"
          min={0}
          max={30}
          defaultValue={s.reminderDaysBefore}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Paiement</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="allowCreditPayment"
            defaultChecked={s.allowCreditPayment}
            className="mt-1"
          />
          <span>
            Le solde de crédits peut régler les factures (1 crédit = 1{" "}
            {s.currency})
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="bankTransferEnabled"
            defaultChecked={s.bankTransferEnabled}
            className="mt-1"
          />
          <span>
            Virement bancaire accepté (paiement constaté manuellement)
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Instructions de paiement (IBAN, BIC, référence à indiquer…)
          </span>
          <textarea
            name="paymentInstructions"
            defaultValue={s.paymentInstructions}
            maxLength={1000}
            className={textareaClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Mention pénalités de retard</span>
          <textarea
            name="latePenaltyMention"
            defaultValue={s.latePenaltyMention}
            maxLength={500}
            className={textareaClass}
          />
        </label>
      </fieldset>

      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Enregistrer les réglages"}
        </Button>
      </div>
    </form>
  )
}

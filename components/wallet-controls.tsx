"use client"

import { useActionState, useState, useTransition } from "react"

import { ConfirmDialog, CopyButton } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  adjustBalanceAction,
  createCouponAction,
  createGiftCardsAction,
  deleteCouponAction,
  deleteGiftCardAction,
  redeemCodeAction,
  saveWalletSettingsAction,
  setCouponActiveAction,
  setGiftCardStatusAction,
  updateCouponAction,
  type WalletState,
} from "@/lib/wallet/actions"

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

function Feedback({ state }: { state: WalletState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    )
  }
  if (state?.ok && state.notice) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {state.notice}
      </p>
    )
  }
  return null
}

/** Date → valeur d'un champ <input type="date"> (jour local). */
function dateValue(d: Date | null | undefined) {
  if (!d) return ""
  const x = new Date(d)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

/** Centimes → saisie « 12,5 ». */
const amountValue = (cents: number | undefined) =>
  cents === undefined ? "" : String(cents / 100).replace(".", ",")

/* ───────────── Client ───────────── */

export function RedeemForm() {
  const [state, action, pending] = useActionState(redeemCodeAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input
          name="code"
          required
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          placeholder="BIENVENUE ou XXXX-XXXX-XXXX-XXXX"
          aria-label="Code coupon ou carte cadeau"
          className="w-80 font-mono uppercase"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Utiliser le code"}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  )
}

/* ───────────── Personnel : solde ───────────── */

export function AdjustBalanceForm({
  userId,
  nonce,
}: {
  userId: string
  nonce: string
}) {
  const [state, action, pending] = useActionState(
    adjustBalanceAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="nonce" value={nonce} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Opération</span>
          <select name="direction" className={`${selectClass} w-32`}>
            <option value="credit">Créditer</option>
            <option value="debit">Débiter</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Montant (crédits)</span>
          <Input
            name="amount"
            inputMode="decimal"
            required
            placeholder="10,00"
            className="w-32"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">Motif (visible par le client)</span>
          <Input name="description" required minLength={3} maxLength={200} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="allowNegative" className="mt-1" />
        <span>Autoriser un solde négatif (débit forcé)</span>
      </label>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Appliquer"}
        </Button>
      </div>
    </form>
  )
}

/* ───────────── Personnel : coupons ───────────── */

type CouponValues = {
  id: string
  code: string
  description: string | null
  amountCents: number
  maxRedemptions: number | null
  perUserLimit: number
  startsAt: Date | null
  expiresAt: Date | null
  isActive: boolean
}

export function CouponForm({ coupon }: { coupon?: CouponValues }) {
  const [state, action, pending] = useActionState(
    coupon ? updateCouponAction : createCouponAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      {coupon && <input type="hidden" name="id" value={coupon.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Code</span>
          <Input
            name="code"
            defaultValue={coupon?.code}
            required
            minLength={3}
            maxLength={32}
            className="font-mono uppercase"
            placeholder="BIENVENUE"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Crédits accordés</span>
          <Input
            name="amount"
            inputMode="decimal"
            defaultValue={amountValue(coupon?.amountCents)}
            required
            placeholder="5"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Description</span>
          <Input
            name="description"
            defaultValue={coupon?.description ?? ""}
            maxLength={200}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Utilisations max (vide = ∞)</span>
          <Input
            name="maxRedemptions"
            type="number"
            min={1}
            defaultValue={coupon?.maxRedemptions ?? ""}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Par compte</span>
          <Input
            name="perUserLimit"
            type="number"
            min={1}
            max={100}
            defaultValue={coupon?.perUserLimit ?? 1}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Début</span>
            <Input
              name="startsAt"
              type="date"
              defaultValue={dateValue(coupon?.startsAt)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Fin</span>
            <Input
              name="expiresAt"
              type="date"
              defaultValue={dateValue(coupon?.expiresAt)}
            />
          </label>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={coupon?.isActive ?? true}
        />
        Actif
      </label>
      <Feedback state={state} />
      <div>
        <Button
          type="submit"
          size={coupon ? "sm" : "default"}
          disabled={pending}
        >
          {pending ? "…" : coupon ? "Enregistrer" : "Créer le coupon"}
        </Button>
      </div>
    </form>
  )
}

export function CouponRowActions({ coupon }: { coupon: CouponValues }) {
  const [busy, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <Button
          size="xs"
          variant="outline"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Fermer" : "Modifier"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await setCouponActiveAction(coupon.id, !coupon.isActive)
              setErr(r?.error ?? null)
            })
          }
        >
          {coupon.isActive ? "Désactiver" : "Activer"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirm(true)}
        >
          Supprimer
        </Button>
      </div>
      {err && (
        <p role="alert" className="text-xs text-destructive">
          {err}
        </p>
      )}
      {editing && (
        <div className="rounded-lg border p-3">
          <CouponForm coupon={coupon} />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Supprimer le coupon ${coupon.code} ?`}
        description="Les crédits déjà accordés restent dans l'historique des clients. Pour simplement l'arrêter, désactive-le."
        confirmLabel="Supprimer"
        destructive
        pending={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            const r = await deleteCouponAction(coupon.id)
            setConfirm(false)
            setErr(r?.error ?? null)
          })
        }
      />
    </div>
  )
}

/* ───────────── Personnel : cartes cadeaux ───────────── */

export function GiftCardForm() {
  const [state, action, pending] = useActionState(
    createGiftCardsAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Crédits</span>
          <Input name="amount" inputMode="decimal" required className="w-28" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Quantité</span>
          <Input
            name="quantity"
            type="number"
            min={1}
            max={100}
            defaultValue={1}
            className="w-24"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Expiration</span>
          <Input name="expiresAt" type="date" />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">Note interne</span>
          <Input name="note" maxLength={200} />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Générer"}
        </Button>
      </div>
      <Feedback state={state} />
      {state?.codes && state.codes.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            Codes générés
            <CopyButton
              value={state.codes.join("\n")}
              label="Copier tous les codes"
            />
          </div>
          <ul className="grid gap-1 font-mono text-sm sm:grid-cols-2">
            {state.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}

export function GiftCardRowActions({
  id,
  code,
  status,
}: {
  id: string
  code: string
  status: "active" | "redeemed" | "disabled"
}) {
  const [busy, start] = useTransition()
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-1">
      <CopyButton value={code} label="Copier le code" />
      {status !== "redeemed" && (
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await setGiftCardStatusAction(
                id,
                status === "active" ? "disabled" : "active"
              )
              setErr(r?.error ?? null)
            })
          }
        >
          {status === "active" ? "Désactiver" : "Réactiver"}
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        className="text-destructive"
        onClick={() => setConfirm(true)}
      >
        Supprimer
      </Button>
      {err && (
        <span role="alert" className="text-xs text-destructive">
          {err}
        </span>
      )}
      <ConfirmDialog
        open={confirm}
        title="Supprimer cette carte cadeau ?"
        description={
          status === "redeemed"
            ? "La carte a été utilisée : les crédits restent acquis au client."
            : "Le code ne pourra plus être utilisé."
        }
        confirmLabel="Supprimer"
        destructive
        pending={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            const r = await deleteGiftCardAction(id)
            setConfirm(false)
            setErr(r?.error ?? null)
          })
        }
      />
    </div>
  )
}

/* ───────────── Administration : réglages ───────────── */

export function WalletSettingsForm({
  settings,
}: {
  settings: {
    billingEnabled: boolean
    signupBonusCents: number
    referralBonusCents: number
    referralTrigger: "signup" | "first_payment"
  }
}) {
  const [state, action, pending] = useActionState(
    saveWalletSettingsAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="billingEnabled"
          defaultChecked={settings.billingEnabled}
          className="mt-1"
        />
        <span>
          Facturation en crédits : le prix de l&apos;offre est débité du solde à
          la commande et au renouvellement (remboursé si l&apos;opération
          échoue). Les administrateurs ne sont jamais débités.
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Bonus de bienvenue (crédits)</span>
        <Input
          name="signupBonus"
          inputMode="decimal"
          defaultValue={amountValue(settings.signupBonusCents)}
          className="w-32"
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Bonus de parrainage (crédits, 0 = désactivé)
          </span>
          <Input
            name="referralBonus"
            inputMode="decimal"
            defaultValue={amountValue(settings.referralBonusCents)}
            className="w-32"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Versé au parrain</span>
          <select
            name="referralTrigger"
            defaultValue={settings.referralTrigger}
            className={selectClass}
          >
            <option value="first_payment">
              À la 1re facture réglée du filleul
            </option>
            <option value="signup">À l&apos;inscription du filleul</option>
          </select>
        </label>
      </div>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  )
}

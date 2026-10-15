import Link from "next/link"

import { LogoutEverywhere, PasswordForm } from "@/components/account-forms"
import { PageHeader, Section } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { ROLE_LABEL } from "@/lib/auth/roles"
import { requireUser } from "@/lib/auth/session"
import { getBalance } from "@/lib/wallet/service"
import { formatCredits } from "@/lib/wallet/format"

export const metadata = { title: "Mon compte" }
export const dynamic = "force-dynamic"

export default async function AccountPage() {
  const user = await requireUser()
  const balance = (await getBalance(user.id)) ?? 0

  return (
    <>
      <PageHeader title="Mon compte" />

      <Section title="Informations">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rôle</dt>
            <dd>{ROLE_LABEL[user.role]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Limite de VPS</dt>
            <dd>{user.serverLimit}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Solde</dt>
            <dd>
              <Link
                className="underline-offset-2 hover:underline"
                href="/wallet"
              >
                {formatCredits(balance)}
              </Link>
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Mot de passe">
        <PasswordForm />
      </Section>

      <Section
        title="Sessions"
        description="Ferme toutes les sessions ouvertes de ce compte."
      >
        <LogoutEverywhere />
      </Section>

      <Section
        title="Données personnelles et conditions"
        description="Exporte tes données, consulte les conditions acceptées ou supprime ton compte (RGPD)."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/legal/my-data" />}
          >
            Mes données personnelles
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/legal" />}
          >
            Documents légaux
          </Button>
        </div>
      </Section>
    </>
  )
}

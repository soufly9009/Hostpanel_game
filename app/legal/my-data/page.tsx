import Link from "next/link"

import { DeleteAccountForm } from "@/components/account-forms"
import { Section } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { deletionBlocker } from "@/lib/account/privacy"
import { requireUser } from "@/lib/auth/session"
import { userAcceptances } from "@/lib/legal/service"

export const metadata = { title: "Mes données personnelles" }
export const dynamic = "force-dynamic"

/**
 * Hors de l'espace client : reste accessible même tant que de nouvelles
 * conditions n'ont pas été acceptées (droit d'accès et d'effacement).
 */
export default async function MyDataPage() {
  const user = await requireUser()
  const [acceptances, blocker] = await Promise.all([
    userAcceptances(user.id),
    deletionBlocker(user),
  ])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Mes données personnelles
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tes droits au titre du RGPD : accès, portabilité et effacement.
          Détails dans la{" "}
          <Link className="underline" href="/legal/confidentialite">
            politique de confidentialité
          </Link>
          .{" "}
          <Link className="underline" href="/account">
            Retour à mon compte
          </Link>
        </p>
      </div>

      <Section
        title="Exporter mes données"
        description="Fichier JSON : compte, services, tickets (hors notes internes), notifications, activité, crédits et acceptations."
      >
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href="/api/account/export" download />}
        >
          Télécharger mes données
        </Button>
      </Section>

      <Section title="Conditions acceptées">
        {acceptances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune acceptation.</p>
        ) : (
          <ul className="divide-y text-sm">
            {acceptances.map((a) => (
              <li
                key={`${a.slug}-${a.version}`}
                className="flex flex-wrap justify-between gap-2 py-2"
              >
                <Link
                  className="underline-offset-2 hover:underline"
                  href={`/legal/${a.slug}?v=${a.version}`}
                >
                  {a.title} · version {a.version}
                </Link>
                <span className="text-muted-foreground">
                  {a.acceptedAt.toLocaleString("fr-FR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Supprimer mon compte"
        tone="danger"
        description="Suppression définitive : compte, tickets, notifications, solde de crédits et historique. Le journal d'activité est anonymisé."
      >
        <DeleteAccountForm blocker={blocker} />
      </Section>
    </div>
  )
}

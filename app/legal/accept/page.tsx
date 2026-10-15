import Link from "next/link"
import { redirect } from "next/navigation"

import { AcceptTermsForm } from "@/components/legal-controls"
import { requireUser } from "@/lib/auth/session"
import { pendingAcceptances } from "@/lib/legal/service"

export const metadata = { title: "Mise à jour des conditions" }
export const dynamic = "force-dynamic"

export default async function AcceptTermsPage() {
  const user = await requireUser()
  const pending = await pendingAcceptances(user.id)
  if (pending.length === 0) redirect("/dashboard")

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Nos conditions ont évolué
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pour continuer à utiliser ton espace, prends connaissance des documents
        suivants et accepte-les. Tu peux aussi exporter tes données ou supprimer
        ton compte depuis la page de ton compte.
      </p>
      <ul className="mt-6 divide-y rounded-xl border bg-card text-sm">
        {pending.map((d) => (
          <li key={d.id} className="flex flex-col gap-1 p-4">
            <Link
              href={`/legal/${d.slug}`}
              target="_blank"
              className="font-medium underline-offset-2 hover:underline"
            >
              {d.title} (version {d.version})
            </Link>
            {d.summary && (
              <span className="text-muted-foreground">{d.summary}</span>
            )}
          </li>
        ))}
      </ul>
      <AcceptTermsForm
        docs={pending.map((d) => ({ id: d.id, version: d.version }))}
      />
      <p className="mt-6 text-xs text-muted-foreground">
        Tu ne souhaites pas accepter ?{" "}
        <Link className="underline" href="/legal/my-data">
          Exporter mes données ou supprimer mon compte
        </Link>
      </p>
    </>
  )
}

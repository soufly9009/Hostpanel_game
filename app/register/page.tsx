import { redirect } from "next/navigation"

import { AuthForm } from "@/components/auth-form"
import { register } from "@/lib/auth/actions"
import { getCurrentUser, homeFor } from "@/lib/auth/session"
import { isInstalled } from "@/lib/install/access"
import { listPublicDocuments } from "@/lib/legal/service"

export const metadata = { title: "Inscription" }
export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await getCurrentUser()
  if (user) redirect(homeFor(user.role))
  if (!(await isInstalled())) redirect("/install/setup")

  const docs = await listPublicDocuments()
  const privacy = docs.find((d) => d.slug === "confidentialite")
  const legal = {
    required: docs
      .filter((d) => d.requiresAcceptance)
      .map((d) => ({ slug: d.slug, title: d.title })),
    privacy: privacy ? { slug: privacy.slug, title: privacy.title } : null,
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <AuthForm mode="register" action={register} legal={legal} />
      </div>
    </div>
  )
}

import { redirect } from "next/navigation"

import { AuthForm } from "@/components/auth-form"
import { login } from "@/lib/auth/actions"
import { getCurrentUser, homeFor } from "@/lib/auth/session"
import { isInstalled } from "@/lib/install/access"

export const metadata = { title: "Connexion" }
export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await getCurrentUser()
  if (user) redirect(homeFor(user.role))
  if (!(await isInstalled())) redirect("/install/setup")

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <AuthForm mode="login" action={login} />
      </div>
    </div>
  )
}

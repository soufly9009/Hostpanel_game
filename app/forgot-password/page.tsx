import { redirect } from "next/navigation"

import { ForgotPasswordForm } from "@/components/reset-forms"
import { getCurrentUser, homeFor } from "@/lib/auth/session"

export const metadata = { title: "Mot de passe oublié" }
export const dynamic = "force-dynamic"

export default async function ForgotPasswordPage() {
  const user = await getCurrentUser()
  if (user) redirect(homeFor(user.role))
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <ForgotPasswordForm />
      </div>
    </div>
  )
}

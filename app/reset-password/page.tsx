import Link from "next/link"

import { ResetPasswordForm } from "@/components/reset-forms"
import { findValidReset } from "@/lib/auth/reset"

export const metadata = {
  title: "Nouveau mot de passe",
  robots: { index: false },
}
export const dynamic = "force-dynamic"

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const token = ((await searchParams).token ?? "").slice(0, 100)
  const valid = await findValidReset(token)
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        {valid ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="rounded-xl border p-6 text-sm">
            <p className="font-medium">Lien invalide ou expiré.</p>
            <p className="mt-2 text-muted-foreground">
              <Link className="underline" href="/forgot-password">
                Refaire une demande
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

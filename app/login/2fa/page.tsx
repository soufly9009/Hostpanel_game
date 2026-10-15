import Link from "next/link"
import { redirect } from "next/navigation"

import { MfaLoginForm } from "@/components/security-controls"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { pendingMfa } from "@/lib/security/mfa"

export const metadata = { title: "Double authentification" }
export const dynamic = "force-dynamic"

export default async function MfaPage() {
  if (!(await pendingMfa())) redirect("/login")
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Double authentification</CardTitle>
            <CardDescription>
              Entre le code affiché par ton application. Tu peux aussi utiliser
              un de tes codes de secours.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MfaLoginForm />
            <p className="mt-4 text-center text-sm text-muted-foreground">
              <Link className="underline" href="/login">
                Annuler
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

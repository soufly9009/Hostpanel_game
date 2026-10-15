import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell"
import { MaintenanceBanners } from "@/components/maintenance-banner"
import { requireUser } from "@/lib/auth/session"
import { pendingAcceptances } from "@/lib/legal/service"
import { unreadCount } from "@/lib/notifications"

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  // Nouvelle version majeure d'un document obligatoire : acceptation requise
  // avant de continuer (l'export et la suppression restent sous /legal).
  const pending = await pendingAcceptances(user.id).catch(() => [])
  if (pending.length > 0) redirect("/legal/accept")

  const unread = await unreadCount(user.id).catch(() => 0)

  return (
    <AppShell
      area="client"
      user={user}
      links={
        user.role === "admin"
          ? [{ href: "/admin", label: "Administration" }]
          : user.role === "support"
            ? [{ href: "/support", label: "Espace support" }]
            : []
      }
      unread={unread}
    >
      <MaintenanceBanners />
      {children}
    </AppShell>
  )
}

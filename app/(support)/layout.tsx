import { AppShell } from "@/components/app-shell"
import { permissionsFor, requireStaff } from "@/lib/auth/permissions"
import { unreadCount } from "@/lib/notifications"

export default async function SupportAreaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Personnel uniquement : les clients sont renvoyés vers /dashboard.
  const user = await requireStaff()
  const [unread, perms] = await Promise.all([
    unreadCount(user.id).catch(() => 0),
    permissionsFor(user),
  ])

  return (
    <AppShell
      area="support"
      user={user}
      unread={unread}
      permissions={[...perms]}
      links={[
        { href: "/dashboard", label: "Espace client" },
        ...(user.role === "admin"
          ? [{ href: "/admin", label: "Administration" }]
          : []),
      ]}
    >
      {children}
    </AppShell>
  )
}

import { AppShell } from "@/components/app-shell"
import { MaintenanceBanners } from "@/components/maintenance-banner"
import { requireAdmin } from "@/lib/auth/session"

export default async function AdminAreaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Les clients sont renvoyés vers /dashboard.
  const user = await requireAdmin()

  return (
    <AppShell
      area="admin"
      user={user}
      links={[
        { href: "/dashboard", label: "Espace client" },
        { href: "/support", label: "Espace support" },
      ]}
    >
      <MaintenanceBanners />
      {children}
    </AppShell>
  )
}

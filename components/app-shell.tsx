import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { siteConfig } from "@/lib/config/site"

export function AppShell({
  area,
  user,
  links,
  unread,
  permissions,
  children,
}: {
  area: "client" | "admin" | "support"
  user: { name: string | null; email: string }
  links?: { href: string; label: string }[]
  unread?: number
  permissions?: string[]
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <AppSidebar
        area={area}
        user={{ name: user.name ?? user.email, email: user.email }}
        siteName={siteConfig.name}
        links={links}
        unread={unread}
        permissions={permissions}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          {area !== "client" && (
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {area === "admin" ? "Admin" : "Support"}
            </span>
          )}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

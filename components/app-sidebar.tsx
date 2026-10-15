"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeftRightIcon, ServerIcon, ShieldIcon } from "lucide-react"

import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { adminNav, clientNav, supportNav } from "@/lib/config/nav"

function isActive(href: string, pathname: string) {
  if (href === "/admin") return pathname === "/admin"
  if (href === "/support") {
    return pathname === "/support" || pathname.startsWith("/support/tickets")
  }
  if (href === "/dashboard") return pathname === "/dashboard"
  if (href === "/servers") {
    return (
      pathname === "/servers" ||
      (pathname.startsWith("/servers/") && pathname !== "/servers/new")
    )
  }
  return pathname.startsWith(href)
}

export function AppSidebar({
  area,
  user,
  siteName,
  links = [],
  unread = 0,
  permissions = [],
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  area: "client" | "admin" | "support"
  user: { name: string; email: string }
  siteName: string
  /** Liens vers les autres espaces accessibles à cet utilisateur. */
  links?: { href: string; label: string }[]
  /** Notifications non lues. */
  unread?: number
  /** Permissions effectives (filtre les entrées de l'espace support). */
  permissions?: string[]
}) {
  const pathname = usePathname()
  const items =
    area === "admin"
      ? adminNav
      : area === "support"
        ? supportNav.filter(
            (i) =>
              !i.permissions ||
              i.permissions.some((p) => permissions.includes(p))
          )
        : clientNav
  const home =
    area === "admin" ? "/admin" : area === "support" ? "/support" : "/dashboard"

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href={home} />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                {area === "admin" ? (
                  <ShieldIcon className="size-4" />
                ) : (
                  <ServerIcon className="size-4" />
                )}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{siteName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {area === "admin"
                    ? "Administration"
                    : area === "support"
                      ? "Espace support"
                      : "Espace client"}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive(item.href, pathname)}
                  render={<Link href={item.href} />}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
                {item.href === "/notifications" && unread > 0 && (
                  <SidebarMenuBadge>
                    {unread > 99 ? "99+" : unread}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {links.length > 0 && (
          <SidebarMenu>
            {links.map((l) => (
              <SidebarMenuItem key={l.href}>
                <SidebarMenuButton
                  tooltip={l.label}
                  render={<Link href={l.href} />}
                >
                  <ArrowLeftRightIcon />
                  <span>{l.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

import {
  BellIcon,
  CoinsIcon,
  FileTextIcon,
  KeyRoundIcon,
  TicketPercentIcon,
  InboxIcon,
  LifeBuoyIcon,
  ShieldCheckIcon,
  HistoryIcon,
  UserIcon,
  ScrollTextIcon,
  BellRingIcon,
  ListChecksIcon,
  DatabaseIcon,
  NetworkIcon,
  WrenchIcon,
  ActivityIcon,
  GaugeIcon,
  GlobeIcon,
  LayersIcon,
  LayoutDashboardIcon,
  PlusIcon,
  ServerIcon,
  UsersIcon,
} from "lucide-react"

export const clientNav = [
  { title: "Tableau de bord", href: "/dashboard", icon: LayoutDashboardIcon },
  { title: "Mes VPS", href: "/servers", icon: ServerIcon },
  { title: "Mes sites web", href: "/sites", icon: GlobeIcon },
  { title: "Nouveau VPS", href: "/servers/new", icon: PlusIcon },
  { title: "Mon solde", href: "/wallet", icon: CoinsIcon },
  { title: "Support", href: "/tickets", icon: LifeBuoyIcon },
  { title: "Notifications", href: "/notifications", icon: BellIcon },
  { title: "Activité", href: "/activity", icon: HistoryIcon },
  { title: "Mon compte", href: "/account", icon: UserIcon },
] as const

/** `permissions` : l'entrée n'apparaît qu'avec au moins l'une d'elles. */
export const supportNav: {
  title: string
  href: string
  icon: typeof InboxIcon
  permissions?: string[]
}[] = [
  { title: "Tickets", href: "/support", icon: InboxIcon },
  {
    title: "Soldes",
    href: "/support/wallet",
    icon: CoinsIcon,
    permissions: ["wallet.view"],
  },
  {
    title: "Coupons et cartes",
    href: "/support/coupons",
    icon: TicketPercentIcon,
    permissions: ["coupons.manage"],
  },
  {
    title: "Documents légaux",
    href: "/support/legal",
    icon: FileTextIcon,
    permissions: ["legal.edit", "legal.publish", "legal.delete"],
  },
]

export const adminNav = [
  { title: "Vue d'ensemble", href: "/admin", icon: GaugeIcon },
  {
    title: "Infrastructure",
    href: "/admin/infrastructure",
    icon: ActivityIcon,
  },
  { title: "Offres", href: "/admin/plans", icon: LayersIcon },
  { title: "IPAM", href: "/admin/ipam", icon: NetworkIcon },
  { title: "Maintenance", href: "/admin/maintenance", icon: WrenchIcon },
  { title: "Migrations", href: "/admin/migrations", icon: DatabaseIcon },
  { title: "VPS", href: "/admin/servers", icon: ServerIcon },
  { title: "Clients", href: "/admin/users", icon: UsersIcon },
  { title: "Rôles", href: "/admin/roles", icon: ShieldCheckIcon },
  { title: "Soldes", href: "/support/wallet", icon: CoinsIcon },
  { title: "Coupons", href: "/support/coupons", icon: TicketPercentIcon },
  { title: "Documents légaux", href: "/support/legal", icon: FileTextIcon },
  { title: "API", href: "/admin/api", icon: KeyRoundIcon },
  { title: "Support", href: "/admin/support", icon: LifeBuoyIcon },
  { title: "Activité", href: "/admin/activity", icon: HistoryIcon },
  { title: "Événements", href: "/admin/events", icon: ListChecksIcon },
  { title: "Journaux Proxmox", href: "/admin/logs", icon: ScrollTextIcon },
  { title: "Discord", href: "/admin/integrations/discord", icon: BellRingIcon },
] as const

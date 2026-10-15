import { PublicShell } from "@/components/public-shell"

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <PublicShell>{children}</PublicShell>
}

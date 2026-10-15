import { PublicShell } from "@/components/public-shell"

export default function NewsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <PublicShell>{children}</PublicShell>
}

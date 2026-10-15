/** Pages imprimables (factures) : sans menu, fond blanc. */
export default function PrintLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="force-light min-h-svh bg-background text-foreground">
      <main className="mx-auto max-w-3xl p-8 print:p-0">{children}</main>
    </div>
  )
}

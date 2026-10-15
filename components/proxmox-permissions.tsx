import type { PermissionReport } from "@/lib/proxmox/permissions"

const STATUS_STYLE = {
  ok: "bg-green-500",
  missing: "bg-destructive",
  unknown: "bg-amber-500",
} as const

const STATUS_LABEL = {
  ok: "OK",
  missing: "Manquant",
  unknown: "Non vérifiable",
} as const

export function ProxmoxPermissions({ report }: { report: PermissionReport }) {
  const token = report.tokenId ?? "user@realm!token"

  if (report.error || !report.connected) {
    return (
      <section className="rounded-xl border border-destructive/40 p-4 text-sm">
        <h2 className="font-medium">Permissions Proxmox</h2>
        <p className="mt-2 text-destructive">
          {report.error ?? "Connexion impossible."}
        </p>
      </section>
    )
  }

  // Regroupe par chemin ACL pour la lisibilité.
  const groups = new Map<string, typeof report.checks>()
  for (const c of report.checks) {
    groups.set(c.path, [...(groups.get(c.path) ?? []), c])
  }

  return (
    <section className="rounded-xl border">
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <h2 className="font-medium">Permissions Proxmox</h2>
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
            report.ready
              ? "bg-green-500/10 text-green-600"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {report.ready
            ? "Tous les droits requis sont présents"
            : "Droits manquants"}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {token} · nœud {report.node}
        </span>
      </header>

      <div className="grid gap-px bg-border md:grid-cols-2">
        <div className="bg-background p-4">
          <h3 className="mb-2 text-sm font-medium">Privilèges</h3>
          {[...groups].map(([path, checks]) => (
            <div key={path} className="mb-3">
              <p className="mb-1 font-mono text-xs text-muted-foreground">
                {path}
              </p>
              <ul className="space-y-1 text-sm">
                {checks.map((c) => (
                  <li key={c.privilege} className="flex items-center gap-2">
                    <span
                      className={`size-2 shrink-0 rounded-full ${STATUS_STYLE[c.status]}`}
                    />
                    <span className="font-mono text-xs">{c.privilege}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.purpose}
                      {c.level === "recommended" && " (conseillé)"}
                    </span>
                    {c.status !== "ok" && (
                      <span className="ml-auto text-xs">
                        {STATUS_LABEL[c.status]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="bg-background p-4">
          <h3 className="mb-2 text-sm font-medium">Tests réels</h3>
          <ul className="space-y-2 text-sm">
            {report.probes.map((p) => (
              <li key={p.name} className="flex items-start gap-2">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${p.ok ? "bg-green-500" : "bg-destructive"}`}
                />
                <span>
                  {p.name}
                  <span className="block text-xs text-muted-foreground">
                    {p.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {report.privilegeSeparation !== null && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          Séparation de privilèges du jeton :{" "}
          <strong>
            {report.privilegeSeparation ? "activée" : "désactivée"}
          </strong>
          {report.privilegeSeparation
            ? " — le jeton n'a que les droits qui lui sont attribués explicitement."
            : " — le jeton hérite des droits de son utilisateur."}
        </p>
      )}

      {!report.ready && (
        <footer className="border-t p-4 text-sm">
          {report.privilegeSeparation ? (
            <p className="mb-3 rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
              Ce jeton a la <strong>séparation de privilèges activée</strong> :
              même si son utilisateur est <code>root@pam</code>, il n&apos;a
              aucun droit par défaut. Soit tu lui attribues les droits
              ci-dessous, soit tu recrées le jeton en{" "}
              <strong>décochant « Privilege Separation »</strong> (Datacenter →
              Permissions → API Tokens).
            </p>
          ) : null}
          <p className="mb-2 font-medium">
            Pour corriger (sur le serveur Proxmox) :
          </p>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
            {`pveum acl modify / --tokens '${token}' --roles PVEVMAdmin,PVEDatastoreUser,PVEAuditor
pveum acl modify /sdn/zones --tokens '${token}' --roles PVESDNUser`}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Si « Privilege Separation » est activé sur le jeton, les droits
            doivent être donnés au jeton lui-même (commande ci-dessus), pas
            seulement à l&apos;utilisateur.
          </p>
        </footer>
      )}
    </section>
  )
}

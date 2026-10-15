"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  CATALOG,
  CATALOG_CATEGORIES,
  summarize,
  type CatalogCategory,
} from "@/lib/firewall/catalog"
import { isDuplicate, type RuleShape } from "@/lib/firewall/rules"

type Props = {
  existing: RuleShape[]
  busy: boolean
  /** Appelé avec les ids choisis et la source (vide = partout). */
  onApply: (ids: string[], source: string) => void
}

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

export function FirewallCatalog({ existing, busy, onApply }: Props) {
  const [category, setCategory] = useState<CatalogCategory | "all">("Jeux")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [source, setSource] = useState("")

  /** Une entrée est « déjà présente » si toutes ses règles existent. */
  const present = useMemo(() => {
    const ids = new Set<string>()
    for (const e of CATALOG) {
      const all = e.rules.every((r) =>
        isDuplicate(
          {
            type: "in",
            action: "ACCEPT",
            proto: r.proto,
            dport: r.dport,
            source: null,
          },
          existing
        )
      )
      if (all) ids.add(e.id)
    }
    return ids
  }, [existing])

  const entries = CATALOG.filter(
    (e) =>
      (category === "all" || e.category === category) &&
      (!query.trim() ||
        `${e.label} ${summarize(e)}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()))
  )

  const chosen = [...selected].filter((id) => !present.has(id))
  const sensitiveChosen = chosen.some(
    (id) => CATALOG.find((e) => e.id === id)?.sensitive
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <details className="rounded-lg border p-3" open>
      <summary className="cursor-pointer text-sm font-medium">
        Catalogue de ports (jeux, bots, voix, web…)
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Catégorie"
            className={selectClass}
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as CatalogCategory | "all")
            }
          >
            <option value="all">Toutes les catégories</option>
            {CATALOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Input
            aria-label="Rechercher"
            placeholder="Rechercher (minecraft, 2333, lavalink…)"
            className="max-w-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {category === "Bots & musique" && (
          <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">
            Un bot Discord n&apos;a besoin d&apos;aucun port entrant : il ne
            fait que des connexions sortantes. N&apos;ouvre que ce dont tu as
            réellement besoin.
          </p>
        )}

        <ul className="grid gap-1.5 sm:grid-cols-2">
          {entries.map((e) => {
            const already = present.has(e.id)
            return (
              <li key={e.id}>
                <label
                  className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                    already ? "opacity-60" : "cursor-pointer hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={already || busy}
                    checked={already || selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {e.label}
                      {e.sensitive && (
                        <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[10px] font-normal text-amber-700 dark:text-amber-400">
                          sensible
                        </span>
                      )}
                      {already && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          ✓ déjà ajouté
                        </span>
                      )}
                    </span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {summarize(e)}
                    </span>
                    {e.note && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {e.note}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            )
          })}
          {entries.length === 0 && (
            <li className="text-sm text-muted-foreground">Aucun résultat.</li>
          )}
        </ul>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            Restreindre à une IP / CIDR (facultatif)
            <Input
              className="w-56"
              placeholder="203.0.113.7 ou 203.0.113.0/24"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={busy || chosen.length === 0}
            onClick={() => {
              onApply(chosen, source.trim())
              setSelected(new Set())
            }}
          >
            Ajouter la sélection ({chosen.length})
          </Button>
        </div>

        {sensitiveChosen && !source.trim() && (
          <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            Tu as choisi un service sensible (base de données, RCON, accès à
            distance) sans restriction d&apos;IP : il serait exposé à tout
            Internet. Indique ton IP dans « Restreindre à une IP ».
          </p>
        )}
      </div>
    </details>
  )
}

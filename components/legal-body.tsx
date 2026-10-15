import type { LegalSectionContent } from "@/lib/db/schema"

/**
 * Rendu d'un texte légal saisi en texte brut : paragraphes séparés par une
 * ligne vide, lignes commençant par « - » en liste. Aucun HTML interprété.
 */
export function LegalBody({ body }: { body: string }) {
  const blocks = body.replace(/\r\n/g, "\n").split(/\n\s*\n/)
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim())
        if (lines.length === 0) return null
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={i} className="my-3 list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*[-•]\s+/, "")}</li>
              ))}
            </ul>
          )
        }
        // Paragraphe éventuellement suivi d'une liste.
        const first = lines.findIndex((l) => /^\s*[-•]\s+/.test(l))
        const text = first === -1 ? lines : lines.slice(0, first)
        const items = first === -1 ? [] : lines.slice(first)
        return (
          <div key={i} className="my-3">
            <p>
              {text.map((l, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {l}
                </span>
              ))}
            </p>
            {items.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {items.map((l, j) => (
                  <li key={j}>{l.replace(/^\s*[-•]\s+/, "")}</li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </>
  )
}

export function LegalSections({
  sections,
}: {
  sections: LegalSectionContent[]
}) {
  return (
    <div className="text-sm leading-relaxed text-muted-foreground">
      {sections.map((s, i) => (
        <section key={i} className="mt-8 first:mt-0">
          <h2 className="text-base font-semibold text-foreground">
            {s.heading}
          </h2>
          <LegalBody body={s.body} />
        </section>
      ))}
    </div>
  )
}

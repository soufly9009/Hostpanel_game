/** Utilitaires purs (client + serveur) pour comparer des règles de pare-feu. */

export type RuleShape = {
  type: string
  action: string
  proto?: string | null
  dport?: string | null
  source?: string | null
}

/** Liste de ports normalisée : triée, sans espaces ("443,80" → "80,443"). */
function normalizePorts(dport?: string | null) {
  if (!dport) return ""
  return dport
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .join(",")
}

/** Clé d'identité : deux règles avec la même clé sont des doublons. */
export function ruleKey(r: RuleShape) {
  return [
    r.type,
    r.action.toUpperCase(),
    (r.proto ?? "").toLowerCase(),
    normalizePorts(r.dport),
    (r.source ?? "").trim().toLowerCase(),
  ].join("|")
}

export function isDuplicate(candidate: RuleShape, existing: RuleShape[]) {
  const key = ruleKey(candidate)
  return existing.some((r) => ruleKey(r) === key)
}

/**
 * Détection d'une violation de contrainte d'unicité. Drizzle enveloppe l'erreur
 * du pilote (`DrizzleQueryError`) : le texte « UNIQUE » est dans `cause`.
 */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e
  for (let i = 0; i < 5 && cur; i++) {
    const err = cur as { message?: unknown; code?: unknown; cause?: unknown }
    if (
      /UNIQUE constraint failed/i.test(String(err.message ?? "")) ||
      /SQLITE_CONSTRAINT_UNIQUE/.test(String(err.code ?? ""))
    ) {
      return true
    }
    cur = err.cause
  }
  return false
}

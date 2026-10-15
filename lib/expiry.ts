/** Aides de calcul d'échéance (utilisables côté client et serveur). */

const DAY = 86_400_000

/** Millisecondes restantes avant `date` (négatif si dépassée). */
export function msUntil(date: Date | string | number) {
  return new Date(date).getTime() - Date.now()
}

/** Jours restants, arrondis au supérieur (0 ou moins = échu). */
export function daysUntil(date: Date | string | number) {
  return Math.ceil(msUntil(date) / DAY)
}

export function isPast(date: Date | string | number) {
  return msUntil(date) <= 0
}

/** Date située dans `days` jours (hors rendu React, pour les requêtes). */
export const inDays = (days: number) => new Date(Date.now() + days * 86_400_000)

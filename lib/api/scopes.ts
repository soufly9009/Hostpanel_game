/** Portées des clés d'API (module pur, partagé serveur/client). */
export const API_SCOPES = [
  { key: "users:read", label: "Lire les comptes" },
  { key: "users:write", label: "Modifier les comptes (nom, limite de VPS)" },
  { key: "wallet:read", label: "Lire les soldes et historiques" },
  { key: "wallet:write", label: "Créditer / débiter un solde" },
  { key: "coupons:read", label: "Lire coupons et cartes cadeaux" },
  { key: "coupons:write", label: "Gérer coupons et cartes cadeaux" },
] as const

export type ApiScope = (typeof API_SCOPES)[number]["key"]
export const API_SCOPE_KEYS: string[] = API_SCOPES.map((s) => s.key)

export const API_KEY_PREFIX = "sou_"

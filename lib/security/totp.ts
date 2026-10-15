import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto"

/**
 * TOTP (RFC 6238) : HMAC-SHA1, pas de 30 s, 6 chiffres, tolérance ±1 pas.
 * Compatible Google Authenticator, Aegis, 1Password, Bitwarden…
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(buf: Buffer) {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "")
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Secret de 160 bits encodé en base32. */
export const generateTotpSecret = () => base32Encode(randomBytes(20))

export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest()
  const off = h[h.length - 1] & 15
  const n =
    ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(n % 1_000_000).padStart(6, "0")
}

/**
 * Vérifie un code ; renvoie le pas utilisé (pour refuser un rejeu) ou null.
 * `lastStep` : dernier pas accepté pour ce compte.
 */
export function verifyTotp(
  secret: string,
  code: string,
  now = Date.now(),
  lastStep = -1
) {
  const c = code.replace(/\s/g, "")
  if (!/^\d{6}$/.test(c)) return null
  const step = Math.floor(now / 30_000)
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue
    const expected = totpCode(secret, s)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return s
  }
  return null
}

export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

/** 10 codes de secours « xxxx-xxxx » (alphabet sans ambiguïté). */
export function generateRecoveryCodes(n = 10) {
  const a = "abcdefghjkmnpqrstuvwxyz23456789"
  const one = () =>
    Array.from({ length: 8 }, () => a[randomInt(a.length)])
      .join("")
      .replace(/^(.{4})/, "$1-")
  return Array.from({ length: n }, one)
}

export const normalizeRecoveryCode = (c: string) =>
  c
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^(.{4})/, "$1-")

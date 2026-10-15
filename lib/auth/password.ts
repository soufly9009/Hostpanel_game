import "server-only"

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"

const KEY_LENGTH = 64

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  )
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `${salt.toString("hex")}:${key.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string) {
  const [saltHex, keyHex] = stored.split(":")
  if (!saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, "hex")
  const key = await derive(password, Buffer.from(saltHex, "hex"))
  return key.length === expected.length && timingSafeEqual(key, expected)
}

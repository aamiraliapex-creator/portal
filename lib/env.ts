/**
 * Centralised, fail-closed configuration access.
 * Never returns a fallback/default secret: a missing or weak secret is a
 * configuration error and must stop the request rather than silently
 * downgrading security.
 */
const MIN_SECRET_LENGTH = 32

let cachedSecret: Uint8Array | null = null

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Raw AUTH_SECRET, validated. Throws ConfigError when unusable. */
export function requireAuthSecret(): string {
  const raw = process.env.AUTH_SECRET
  if (!raw || raw.trim().length === 0) {
    throw new ConfigError('AUTH_SECRET is not set. Refusing to sign or verify sessions with an insecure default.')
  }
  if (raw.trim().length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`)
  }
  return raw
}

/** Encoded key for jose. Cached per process. */
export function authSecretKey(): Uint8Array {
  if (!cachedSecret) cachedSecret = new TextEncoder().encode(requireAuthSecret())
  return cachedSecret
}

/** True when a usable AUTH_SECRET is configured (no throw). */
export function hasAuthSecret(): boolean {
  try { requireAuthSecret(); return true } catch { return false }
}

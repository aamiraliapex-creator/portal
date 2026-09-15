import bcrypt from 'bcryptjs'

/**
 * bcrypt only considers the first 72 BYTES of a password and silently ignores
 * the rest. Two different long passwords sharing a 72-byte prefix would then
 * be interchangeable, so we reject anything longer at every point a password
 * is accepted (account creation, password change) rather than truncating.
 */
export const BCRYPT_MAX_BYTES = 72

/** Absolute cap on submitted password length, to bound hashing work per request. */
export const PASSWORD_MAX_INPUT_BYTES = 1024

export const passwordByteLength = (plain: string): number => Buffer.byteLength(plain, 'utf8')

export const isWithinBcryptLimit = (plain: string): boolean =>
  passwordByteLength(plain) <= BCRYPT_MAX_BYTES

/**
 * A fixed, valid bcrypt hash of a value no user can hold. Used to run a real
 * comparison when the account does not exist or is disabled, so unknown and
 * known accounts follow approximately the same verification path instead of
 * returning early (which leaks account existence through response timing).
 */
export const DUMMY_PASSWORD_HASH = '$2a$12$xBHweIM9Bi2c7dMh8uskROYXb6ZMds9L/QjI6sRUHsoUaglDBSc7e'

export async function hashPassword(plain: string): Promise<string> {
  if (!isWithinBcryptLimit(plain)) {
    throw new Error(`Password must be at most ${BCRYPT_MAX_BYTES} bytes.`)
  }
  return bcrypt.hash(plain, 12)
}

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash)

/**
 * Comparison that always does bcrypt work, even when there is no account.
 * Returns false for a missing/blank hash after burning an equivalent compare.
 */
export async function verifyPasswordConstantish(plain: string, hash: string | null | undefined): Promise<boolean> {
  const target = hash && hash.startsWith('$2') ? hash : DUMMY_PASSWORD_HASH
  const result = await bcrypt.compare(plain, target)
  return hash ? result : false
}

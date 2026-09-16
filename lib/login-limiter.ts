import type { getSql } from './db'

/** Password verifications permitted per active window. */
export const MAX_ATTEMPTS = 5
/** How long the account is locked once the threshold is reached. */
export const LOCK_MINUTES = 15
/** A quiet period this long starts a fresh attempt window. */
export const WINDOW_MINUTES = 15
/** Rows untouched for this long are pruned. */
export const ATTEMPT_TTL_HOURS = 24

export type Admission =
  | { admitted: true; attempts: number; lockedUntil: Date | null }
  | { admitted: false; lockedUntil: Date }

/**
 * Atomically reserves one password-verification slot for `email`.
 *
 * This must run BEFORE bcrypt. The previous design checked `locked_until`,
 * then ran bcrypt, then incremented the counter — so a simultaneous burst
 * could all pass the "not locked" check and test many passwords before the
 * counter ever reached the threshold (an admission bypass).
 *
 * Reservations are serialized per normalized email with a transaction-scoped
 * advisory lock, so concurrent requests queue and each receives a distinct
 * attempt number. The lock is released at commit — bcrypt runs afterwards and
 * never holds it.
 *
 * Semantics:
 *  - active lock          -> denied, and `locked_until` is left untouched so
 *                            hammering cannot extend a lock indefinitely
 *  - lock just expired    -> fresh window starting at attempt 1 (no instant relock)
 *  - quiet longer than the window -> fresh window at attempt 1
 *  - otherwise            -> attempts + 1; reaching MAX_ATTEMPTS admits that
 *                            attempt and arms the lock for the next one
 */
export async function reserveAttempt(sql: ReturnType<typeof getSql>, email: string): Promise<Admission> {
  return sql.begin(async (tx) => {
    // Serialize every reservation for this address.
    await tx`select pg_advisory_xact_lock(hashtext(${email})::bigint)`

    const [row] = await tx<{ attempts: number; locked_until: Date | null; updated_at: Date }[]>`
      select attempts, locked_until, updated_at from login_attempts where email = ${email} limit 1`

    const now = new Date()

    if (row?.locked_until && new Date(row.locked_until) > now) {
      // Denied. Deliberately no write: the lock must not be extended.
      return { admitted: false as const, lockedUntil: new Date(row.locked_until) }
    }

    const lockExpired = !!row?.locked_until && new Date(row.locked_until) <= now
    const windowStale =
      !!row && !row.locked_until &&
      new Date(row.updated_at).getTime() < now.getTime() - WINDOW_MINUTES * 60_000

    const attempts = !row || lockExpired || windowStale ? 1 : Number(row.attempts) + 1
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null

    await tx`
      insert into login_attempts (email, attempts, locked_until, updated_at)
      values (${email}, ${attempts}, ${lockedUntil}, now())
      on conflict (email) do update
        set attempts = ${attempts}, locked_until = ${lockedUntil}, updated_at = now()`

    return { admitted: true as const, attempts, lockedUntil }
  }) as Promise<Admission>
}

/** Clears the counter after a successful sign-in. */
export async function clearAttempts(sql: ReturnType<typeof getSql>, email: string): Promise<void> {
  await sql`delete from login_attempts where email = ${email}`
}

/** Bounded cleanup of stale rows; an active lock is never pruned. */
export async function pruneStaleAttempts(sql: ReturnType<typeof getSql>): Promise<void> {
  await sql`
    delete from login_attempts
     where updated_at < now() - (${ATTEMPT_TTL_HOURS} || ' hours')::interval
       and (locked_until is null or locked_until < now())`
}

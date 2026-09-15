import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import {
  verifyPasswordConstantish, isWithinBcryptLimit, PASSWORD_MAX_INPUT_BYTES, passwordByteLength,
} from '@/lib/password'
import { createSession } from '@/lib/session'
import { normalizeEmail, isValidEmail, EMAIL_MAX_LENGTH } from '@/lib/validation'
export const runtime = 'nodejs'

type U = { id: string; name: string; email: string; password_hash: string; role: string; status: string; session_version: number }

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15
/** Rows untouched for this long are pruned so unknown-email spam cannot grow the table. */
const ATTEMPT_TTL_HOURS = 24

/** Generic message: never reveals whether the account exists, is disabled, or the password was wrong. */
const GENERIC_CREDENTIALS = 'These credentials do not match our records.'

/**
 * Atomically records one failed attempt and returns the new state.
 *
 * The counter is incremented from the row's own value inside a single
 * statement (`attempts = login_attempts.attempts + 1`). Reading the count and
 * later writing `old + 1` would let concurrent requests overwrite each other
 * and reset progress toward the lockout.
 */
async function recordFailure(sql: ReturnType<typeof getSql>, email: string) {
  const [row] = await sql<{ attempts: number; locked_until: string | null }[]>`
    insert into login_attempts (email, attempts, locked_until, updated_at)
    values (${email}, 1, null, now())
    on conflict (email) do update
      set attempts = login_attempts.attempts + 1,
          locked_until = case
            when login_attempts.attempts + 1 >= ${MAX_ATTEMPTS}
              then now() + (${LOCK_MINUTES} || ' minutes')::interval
            else login_attempts.locked_until
          end,
          updated_at = now()
    returning attempts, locked_until`
  return row
}

/** Bounded cleanup of stale rows; cheap thanks to the updated_at index. */
async function pruneStaleAttempts(sql: ReturnType<typeof getSql>) {
  await sql`
    delete from login_attempts
     where updated_at < now() - (${ATTEMPT_TTL_HOURS} || ' hours')::interval
       and (locked_until is null or locked_until < now())`
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))

    // ---- validate and normalise BEFORE touching the database ----
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
      return NextResponse.json({ error: 'Email and password required.' }, { status: 400 })
    }
    const email = normalizeEmail(body.email)
    const password = body.password
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required.' }, { status: 400 })
    }
    if (email.length > EMAIL_MAX_LENGTH || !isValidEmail(email)) {
      return NextResponse.json({ error: GENERIC_CREDENTIALS }, { status: 401 })
    }
    // Bound hashing work per request; oversized input can never match a stored
    // hash because we reject >72 bytes at account creation and password change.
    if (passwordByteLength(password) > PASSWORD_MAX_INPUT_BYTES) {
      return NextResponse.json({ error: GENERIC_CREDENTIALS }, { status: 401 })
    }

    const sql = getSql()

    const [lock] = await sql<{ locked_until: string | null }[]>`
      select locked_until from login_attempts where email = ${email} limit 1`
    if (lock?.locked_until && new Date(lock.locked_until) > new Date()) {
      return NextResponse.json({ error: 'Too many attempts. Please try again in a few minutes.' }, { status: 429 })
    }

    const rows = await sql<U[]>`
      select id, name, email, password_hash, role, status, coalesce(session_version,0) as session_version
        from users where email = ${email} limit 1`
    const user = rows[0]

    // Always run a bcrypt comparison — against the stored hash when the account
    // exists and is active, otherwise against a fixed dummy hash — so unknown,
    // disabled and known-but-wrong-password all take a similar amount of work.
    const usableHash = user && user.status === 'ACTIVE' ? user.password_hash : null
    const passwordMatches = await verifyPasswordConstantish(password, usableHash)
    const good = !!user && user.status === 'ACTIVE' && passwordMatches && isWithinBcryptLimit(password)

    if (!good) {
      try {
        await recordFailure(sql, email)
        await pruneStaleAttempts(sql)
      } catch (e) {
        console.error('login attempt bookkeeping failed:', e instanceof Error ? e.message : e)
      }
      return NextResponse.json({ error: GENERIC_CREDENTIALS }, { status: 401 })
    }

    try { await sql`delete from login_attempts where email = ${email}` } catch {}
    try { await sql`update users set last_login_at = now() where id = ${user!.id}` } catch {}
    await createSession({ id: user!.id, name: user!.name, email: user!.email, role: user!.role, sv: Number(user!.session_version ?? 0) })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('login error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, { status: 500 })
  }
}

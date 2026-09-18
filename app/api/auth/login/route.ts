import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import {
  verifyPasswordConstantish, isWithinBcryptLimit, PASSWORD_MAX_INPUT_BYTES, passwordByteLength,
} from '@/lib/password'
import { createSession } from '@/lib/session'
import { normalizeEmail, isValidEmail, EMAIL_MAX_LENGTH } from '@/lib/validation'
import { reserveAttempt, clearAttempts, pruneStaleAttempts } from '@/lib/login-limiter'
import { createUserSession, pruneSessions } from '@/lib/sessions'
export const runtime = 'nodejs'

type U = { id: string; name: string; email: string; password_hash: string; role: string; status: string; session_version: number }

/** Never reveals whether the account exists, is disabled, or the password was wrong. */
const GENERIC_CREDENTIALS = 'These credentials do not match our records.'
const TOO_MANY = 'Too many attempts. Please try again in a few minutes.'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))

    // ---- validate and normalise BEFORE any database access ----
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
    if (passwordByteLength(password) > PASSWORD_MAX_INPUT_BYTES) {
      return NextResponse.json({ error: GENERIC_CREDENTIALS }, { status: 401 })
    }

    const sql = getSql()

    // ---- admission control BEFORE bcrypt ----
    // Reserving a slot and enforcing the threshold happen in one serialized
    // operation, so a simultaneous burst cannot slip past an "unlocked" read
    // and test many passwords before the counter catches up.
    const admission = await reserveAttempt(sql, email)
    if (!admission.admitted) {
      // The supplied password is never tested while locked.
      return NextResponse.json({ error: TOO_MANY }, { status: 429 })
    }

    const rows = await sql<U[]>`
      select id, name, email, password_hash, role, status, coalesce(session_version,0) as session_version
        from users where email = ${email} limit 1`
    const user = rows[0]

    // Always do bcrypt work — against a fixed dummy hash when the account is
    // missing or disabled — so admitted attempts follow a similar path.
    const usableHash = user && user.status === 'ACTIVE' ? user.password_hash : null
    const passwordMatches = await verifyPasswordConstantish(password, usableHash)
    const good = !!user && user.status === 'ACTIVE' && passwordMatches && isWithinBcryptLimit(password)

    if (!good) {
      // The attempt was already counted by the reservation above.
      try { await pruneStaleAttempts(sql) } catch (e) {
        console.error('login attempt cleanup failed:', e instanceof Error ? e.message : e)
      }
      return NextResponse.json({ error: GENERIC_CREDENTIALS }, { status: 401 })
    }

    try { await clearAttempts(sql, email) } catch {}
    try { await sql`update users set last_login_at = now() where id = ${user!.id}` } catch {}
    // A distinct database session per sign-in, so each device can be listed
    // and revoked individually. Only an opaque random key is stored.
    const { sessionKey } = await createUserSession(user!.id, {
      userAgent: req.headers.get('user-agent'),
      ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
    })
    try { await pruneSessions() } catch {}
    await createSession({ id: user!.id, name: user!.name, email: user!.email, role: user!.role, sv: Number(user!.session_version ?? 0), sid: sessionKey })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('login error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, { status: 500 })
  }
}

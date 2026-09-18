import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { requireUser, authzResponse } from '@/lib/auth-server'
import { hashPassword, verifyPassword, isWithinBcryptLimit, BCRYPT_MAX_BYTES } from '@/lib/password'
import { createSession, getSessionClaims } from '@/lib/session'
import { revokeAllSessions, createUserSession } from '@/lib/sessions'
export const runtime = 'nodejs'

const MIN_PASSWORD = 12

export async function POST(req: Request) {
  try {
    const me = await requireUser()
    const b = await req.json().catch(() => ({}))
    const current = typeof b.current === 'string' ? b.current : ''
    const next = typeof b.next === 'string' ? b.next : ''
    if (!current || !next) return NextResponse.json({ error: 'Both fields are required.' }, { status: 400 })
    if (next.length < MIN_PASSWORD) return NextResponse.json({ error: `New password must be at least ${MIN_PASSWORD} characters.` }, { status: 400 })
    if (!isWithinBcryptLimit(next)) return NextResponse.json({ error: `New password must be at most ${BCRYPT_MAX_BYTES} bytes.` }, { status: 400 })
    if (next === current) return NextResponse.json({ error: 'Choose a password different from the current one.' }, { status: 400 })

    const sql = getSql()
    const [u] = await sql<{ password_hash: string }[]>`select password_hash from users where id = ${me.id} limit 1`
    if (!u || !(await verifyPassword(current, u.password_hash))) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })
    }

    // Bumping session_version invalidates every previously issued token for
    // this account (including any stolen one), then we re-issue for this device.
    const [updated] = await sql<{ session_version: number }[]>`
      update users
         set password_hash = ${await hashPassword(next)},
             session_version = coalesce(session_version, 0) + 1
       where id = ${me.id}
       returning session_version`
    // Every existing device session is revoked, then one fresh session is
    // issued for the browser that performed the change.
    await revokeAllSessions(me.id)
    const { sessionKey } = await createUserSession(me.id, {
      userAgent: req.headers.get('user-agent'),
      ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
    })
    await createSession({ id: me.id, name: me.name, email: me.email, role: me.role, sv: Number(updated.session_version), sid: sessionKey })
    return NextResponse.json({ ok: true })
  } catch (e) { return authzResponse(e) ?? NextResponse.json({ error: 'Request failed.' }, { status: 500 }) }
}

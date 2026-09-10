import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { verifyPassword } from '@/lib/password'
import { createSession } from '@/lib/session'
export const runtime = 'nodejs'

type U = { id: string; name: string; email: string; password_hash: string; role: string; status: string }
const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json().catch(() => ({}))
    if (!email || !password) return NextResponse.json({ error: 'Email and password required.' }, { status: 400 })
    const emailLc = String(email).toLowerCase()

    await ensureSchemaOnce()
    const sql = getSql()

    let la: { attempts: number; locked_until: string | null } | undefined
    try {
      const r = await sql<{ attempts: number; locked_until: string | null }[]>`select attempts, locked_until from login_attempts where email = ${emailLc}`
      la = r[0]
    } catch { la = undefined }
    if (la?.locked_until && new Date(la.locked_until) > new Date()) {
      return NextResponse.json({ error: 'Too many attempts. Please try again in a few minutes.' }, { status: 429 })
    }

    const rows = await sql<U[]>`select id, name, email, password_hash, role, status from users where email = ${emailLc} limit 1`
    const user = rows[0]
    const good = !!user && user.status === 'ACTIVE' && (await verifyPassword(password, user.password_hash))

    if (!good) {
      try {
        const attempts = (la?.attempts || 0) + 1
        const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null
        await sql`insert into login_attempts (email, attempts, locked_until, updated_at)
          values (${emailLc}, ${attempts}, ${lockedUntil}, now())
          on conflict (email) do update set attempts = ${attempts}, locked_until = ${lockedUntil}, updated_at = now()`
      } catch { /* ignore */ }
      return NextResponse.json({ error: 'These credentials do not match our records.' }, { status: 401 })
    }

    try { await sql`delete from login_attempts where email = ${emailLc}` } catch {}
    try { await sql`update users set last_login_at = now() where id = ${user!.id}` } catch {}
    await createSession({ id: user!.id, name: user!.name, email: user!.email, role: user!.role })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Server error'
    console.error('login error:', msg)
    return NextResponse.json({ error: 'Login failed: ' + msg }, { status: 500 })
  }
}

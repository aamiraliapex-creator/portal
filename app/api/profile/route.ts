import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { getCurrentUser } from '@/lib/authz'
import { createSession } from '@/lib/session'
import { hashPassword, verifyPassword } from '@/lib/password'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const actor = await getCurrentUser()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b.current || !b.next) return NextResponse.json({ error: 'Both fields are required.' }, { status: 400 })
  if (String(b.next).length < 8) return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })

  const sql = getSql()
  const [u] = await sql<{ password_hash: string; token_version: number }[]>`select password_hash, coalesce(token_version,0) as token_version from users where id = ${actor.id} limit 1`
  if (!u || !(await verifyPassword(b.current, u.password_hash))) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })

  // Bumping token_version invalidates every session issued before this change — including,
  // deliberately, this request's own current cookie. We immediately re-issue a fresh one
  // below (with the new token_version) so the person changing their own password stays
  // logged in, while any *other* session/device using the old password is logged out.
  const newTokenVersion = u.token_version + 1
  await sql`update users set password_hash = ${await hashPassword(b.next)}, token_version = ${newTokenVersion} where id = ${actor.id}`
  await createSession({ id: actor.id, name: actor.name, email: actor.email, role: actor.role, tokenVersion: newTokenVersion })
  return NextResponse.json({ ok: true })
}

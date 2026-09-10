import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { getSession } from '@/lib/session'
import { hashPassword, verifyPassword } from '@/lib/password'
export const runtime = 'nodejs'
export async function POST(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b.current || !b.next) return NextResponse.json({ error: 'Both fields are required.' }, { status: 400 })
  if (String(b.next).length < 8) return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })
  const sql = getSql()
  const [u] = await sql<{ password_hash: string }[]>`select password_hash from users where id = ${s.id} limit 1`
  if (!u || !(await verifyPassword(b.current, u.password_hash))) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })
  await sql`update users set password_hash = ${await hashPassword(b.next)} where id = ${s.id}`
  return NextResponse.json({ ok: true })
}

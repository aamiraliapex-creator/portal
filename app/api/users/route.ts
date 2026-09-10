import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getSession } from '@/lib/session'
import { hashPassword } from '@/lib/password'
export const runtime = 'nodejs'

const MANAGE_ROLES = ['SUPER_ADMIN', 'ADMIN']

export async function POST(req: Request) {
  const s = await getSession(); if (!s || !MANAGE_ROLES.includes(s.role)) return NextResponse.json({ error: 'Only an admin can add users.' }, { status: 403 })
  await ensureSchemaOnce()
  const b = await req.json().catch(() => ({}))
  if (!b.name || !b.email || !b.password) return NextResponse.json({ error: 'Name, email and password are required.' }, { status: 400 })
  if (String(b.password).length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  const sql = getSql()
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into users (name, email, password_hash, role, status)
      values (${b.name}, ${String(b.email).toLowerCase()}, ${await hashPassword(b.password)}, ${b.role || 'CASE_AGENT'}, ${b.status || 'ACTIVE'})
      returning id`
    return NextResponse.json({ ok: true, id: row.id })
  } catch { return NextResponse.json({ error: 'That email is already in use.' }, { status: 409 }) }
}

export async function PATCH(req: Request) {
  const s = await getSession(); if (!s || !MANAGE_ROLES.includes(s.role)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id || !b.status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  const sql = getSql()
  await sql`update users set status = ${b.status} where id = ${b.id}`
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const s = await getSession(); if (!s || s.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Only a Super Admin can delete users.' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (id === s.id) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  const sql = getSql()
  await sql`delete from users where id = ${id}`
  return NextResponse.json({ ok: true })
}

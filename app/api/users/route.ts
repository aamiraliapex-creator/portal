import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { hashPassword } from '@/lib/password'
import { getCurrentUser, canManageUsers, canDeleteUsers, canManageRole, isRole, isStatus } from '@/lib/authz'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const actor = await getCurrentUser()
  if (!canManageUsers(actor)) return NextResponse.json({ error: 'Only an admin can add users.' }, { status: 403 })
  await ensureSchemaOnce()
  const b = await req.json().catch(() => ({}))
  if (!b.name || !b.email || !b.password) return NextResponse.json({ error: 'Name, email and password are required.' }, { status: 400 })
  if (String(b.password).length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })

  const role = b.role || 'CASE_AGENT'
  const status = b.status || 'ACTIVE'
  if (!isRole(role)) return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
  if (!isStatus(status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  // Privilege escalation guard: an ADMIN cannot create an ADMIN or SUPER_ADMIN account —
  // only a SUPER_ADMIN can create accounts at ADMIN rank or above.
  if (!canManageRole(actor!, role)) return NextResponse.json({ error: 'You cannot create a user with that role.' }, { status: 403 })

  const sql = getSql()
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into users (name, email, password_hash, role, status)
      values (${b.name}, ${String(b.email).toLowerCase()}, ${await hashPassword(b.password)}, ${role}, ${status})
      returning id`
    return NextResponse.json({ ok: true, id: row.id })
  } catch { return NextResponse.json({ error: 'That email is already in use.' }, { status: 409 }) }
}

export async function PATCH(req: Request) {
  const actor = await getCurrentUser()
  if (!canManageUsers(actor)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (b.status !== undefined && !isStatus(b.status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  if (b.role !== undefined && !isRole(b.role)) return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
  if (b.status === undefined && b.role === undefined) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const sql = getSql()
  const [target] = await sql<{ id: string; role: string; status: string }[]>`select id, role, status from users where id = ${b.id} limit 1`
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  // An actor can only manage accounts at or below their own rank (SUPER_ADMIN excepted) —
  // this stops an ADMIN from disabling, re-enabling, or re-role-ing another ADMIN or a
  // SUPER_ADMIN, and stops assigning a role above what the actor is allowed to grant.
  if (!canManageRole(actor!, target.role)) return NextResponse.json({ error: 'You cannot manage this account.' }, { status: 403 })
  if (b.role !== undefined && !canManageRole(actor!, b.role)) return NextResponse.json({ error: 'You cannot assign that role.' }, { status: 403 })

  // Never allow the last active Super Admin to be disabled or demoted — that would lock
  // the whole org out of the highest privilege tier with no way back in short of direct
  // database access.
  const wouldRemoveLastSuperAdmin =
    target.role === 'SUPER_ADMIN' &&
    target.status === 'ACTIVE' &&
    ((b.status !== undefined && b.status !== 'ACTIVE') || (b.role !== undefined && b.role !== 'SUPER_ADMIN'))
  if (wouldRemoveLastSuperAdmin) {
    const [{ count }] = await sql<{ count: string }[]>`select count(*)::text as count from users where role = 'SUPER_ADMIN' and status = 'ACTIVE'`
    if (Number(count) <= 1) return NextResponse.json({ error: 'You cannot disable or demote the last active Super Admin.' }, { status: 400 })
  }

  // Changing role or status revokes any session already issued for this account — bumping
  // token_version makes every existing JWT for this user fail getCurrentUser()'s check on
  // its very next request, instead of staying valid until natural (8h) expiry.
  await sql`update users set
      status = coalesce(${b.status ?? null}, status),
      role = coalesce(${b.role ?? null}, role),
      token_version = token_version + 1
    where id = ${b.id}`
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const actor = await getCurrentUser()
  if (!canDeleteUsers(actor)) return NextResponse.json({ error: 'Only a Super Admin can delete users.' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (id === actor!.id) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })

  const sql = getSql()
  const [target] = await sql<{ role: string; status: string }[]>`select role, status from users where id = ${id} limit 1`
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  if (target.role === 'SUPER_ADMIN' && target.status === 'ACTIVE') {
    const [{ count }] = await sql<{ count: string }[]>`select count(*)::text as count from users where role = 'SUPER_ADMIN' and status = 'ACTIVE'`
    if (Number(count) <= 1) return NextResponse.json({ error: 'You cannot delete the last active Super Admin.' }, { status: 400 })
  }
  await sql`delete from users where id = ${id}`
  return NextResponse.json({ ok: true })
}

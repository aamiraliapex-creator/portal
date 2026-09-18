import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { requirePermission, authzResponse } from '@/lib/auth-server'
import { hashPassword, isWithinBcryptLimit, BCRYPT_MAX_BYTES } from '@/lib/password'
import { canManageRole, isRole, isUserStatus, ROLE_RANK, type Role } from '@/lib/authz'
import { revokeAllSessions } from '@/lib/sessions'
export const runtime = 'nodejs'

const MIN_PASSWORD = 12

/** Number of OTHER active super admins (excluding `excludeId`). */
async function otherActiveSuperAdmins(sql: ReturnType<typeof getSql>, excludeId: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int n from users where role = 'SUPER_ADMIN' and status = 'ACTIVE' and id <> ${excludeId}`
  return r?.n ?? 0
}

export async function POST(req: Request) {
  try {
    const actor = await requirePermission('user.manage')
    const b = await req.json().catch(() => ({}))
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
    const password = typeof b.password === 'string' ? b.password : ''
    const role = b.role ?? 'CASE_AGENT'
    const status = b.status ?? 'ACTIVE'

    if (!name || !email || !password) return NextResponse.json({ error: 'Name, email and password are required.' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    if (password.length < MIN_PASSWORD) return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, { status: 400 })
    // bcrypt ignores anything past 72 bytes; reject rather than silently truncate.
    if (!isWithinBcryptLimit(password)) return NextResponse.json({ error: `Password must be at most ${BCRYPT_MAX_BYTES} bytes.` }, { status: 400 })
    if (!isRole(role)) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 })
    if (!isUserStatus(status)) return NextResponse.json({ error: 'Unknown status.' }, { status: 400 })
    // Allowlist + hierarchy: blocks ADMIN -> SUPER_ADMIN escalation.
    if (!canManageRole(actor.role, role)) {
      return NextResponse.json({ error: 'You cannot create an account with that role.' }, { status: 403 })
    }

    const sql = getSql()
    try {
      const [row] = await sql<{ id: string }[]>`
        insert into users (name, email, password_hash, role, status)
        values (${name}, ${email}, ${await hashPassword(password)}, ${role}, ${status})
        returning id`
      return NextResponse.json({ ok: true, id: row.id })
    } catch {
      return NextResponse.json({ error: 'That email is already in use.' }, { status: 409 })
    }
  } catch (e) { return authzResponse(e) ?? NextResponse.json({ error: 'Request failed.' }, { status: 500 }) }
}

export async function PATCH(req: Request) {
  try {
    const actor = await requirePermission('user.manage')
    const b = await req.json().catch(() => ({}))
    const id = typeof b.id === 'string' ? b.id : ''
    const status = b.status
    if (!id || !isUserStatus(status)) return NextResponse.json({ error: 'A user id and a valid status are required.' }, { status: 400 })

    const sql = getSql()
    const [target] = await sql<{ id: string; role: string; status: string }[]>`
      select id, role, status from users where id = ${id} limit 1`
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    if (!isRole(target.role)) return NextResponse.json({ error: 'User has an invalid role.' }, { status: 409 })

    // An actor may never modify an account at or above their own privilege level
    // (self-service lives in /api/profile).
    if (target.id === actor.id) return NextResponse.json({ error: 'You cannot change your own status here.' }, { status: 400 })
    if (!canManageRole(actor.role, target.role)) {
      return NextResponse.json({ error: 'You cannot manage an account with that role.' }, { status: 403 })
    }
    // Never strand the system without an active super admin.
    if (target.role === 'SUPER_ADMIN' && status === 'DISABLED' && (await otherActiveSuperAdmins(sql, target.id)) === 0) {
      return NextResponse.json({ error: 'Cannot disable the last active super admin.' }, { status: 409 })
    }

    // Disabling also revokes existing sessions for that account.
    if (status === 'DISABLED') {
      await sql`update users set status = ${status}, session_version = coalesce(session_version,0) + 1 where id = ${id}`
      // Also revoke the individual session rows, so re-enabling the account
      // cannot resurrect pre-disable sessions or list them as active.
      await revokeAllSessions(id)
    } else {
      await sql`update users set status = ${status} where id = ${id}`
    }
    return NextResponse.json({ ok: true })
  } catch (e) { return authzResponse(e) ?? NextResponse.json({ error: 'Request failed.' }, { status: 500 }) }
}

export async function DELETE(req: Request) {
  try {
    const actor = await requirePermission('user.delete')
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'A user id is required.' }, { status: 400 })
    if (id === actor.id) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })

    const sql = getSql()
    const [target] = await sql<{ id: string; role: string }[]>`select id, role from users where id = ${id} limit 1`
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    if (!isRole(target.role)) return NextResponse.json({ error: 'User has an invalid role.' }, { status: 409 })
    if (target.role === 'SUPER_ADMIN' && (await otherActiveSuperAdmins(sql, target.id)) === 0) {
      return NextResponse.json({ error: 'Cannot delete the last active super admin.' }, { status: 409 })
    }
    if (ROLE_RANK[actor.role] > ROLE_RANK[target.role as Role]) {
      return NextResponse.json({ error: 'You cannot delete a more privileged account.' }, { status: 403 })
    }

    await sql`delete from users where id = ${id}`
    return NextResponse.json({ ok: true })
  } catch (e) { return authzResponse(e) ?? NextResponse.json({ error: 'Request failed.' }, { status: 500 }) }
}

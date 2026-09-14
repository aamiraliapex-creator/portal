import { cache } from 'react'
import { getSql } from './db'
import { getSession } from './session'
import { isRole } from './permissions'

// Re-export the pure permission matrix so existing `from '@/lib/authz'` imports keep working.
export * from './permissions'
import type { CurrentUser } from './permissions'

/**
 * The authoritative "who is making this request" check. Unlike the raw session cookie,
 * this re-reads status/role/token_version from the database on every call, so:
 *  - a disabled or deleted account stops working immediately, not just after the JWT expires
 *  - a role change (e.g. demotion) takes effect on the very next request
 *  - a password change invalidates every session issued before it (token_version mismatch)
 * Wrapped in React's `cache()` so multiple calls within one request/render only hit the DB once.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession()
  if (!session) return null
  const sql = getSql()
  let rows: { id: string; name: string; email: string; role: string; status: string; token_version: number }[]
  try {
    rows = await sql`select id, name, email, role, status, coalesce(token_version, 0) as token_version from users where id = ${session.id} limit 1`
  } catch {
    return null
  }
  const u = rows[0]
  if (!u) return null
  if (u.status !== 'ACTIVE') return null
  if (session.tokenVersion !== u.token_version) return null
  if (!isRole(u.role)) return null
  return { id: u.id, name: u.name, email: u.email, role: u.role, tokenVersion: u.token_version }
})

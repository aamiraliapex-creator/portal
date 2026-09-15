import { getSql } from './db'
import { getSessionClaims } from './session'
import { hasPermission, isRole, type Permission, type Role } from './authz'

export type CurrentUser = { id: string; name: string; email: string; role: Role; status: string }

/**
 * Authoritative identity for the current request.
 *
 * Verifies the JWT AND re-checks the account against the database on every
 * call, so that disabled/deleted accounts, role downgrades and password
 * changes (session_version bump) take effect immediately instead of waiting
 * for the 8h token to expire.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const claims = await getSessionClaims()
  if (!claims) return null
  try {
    const sql = getSql()
    const rows = await sql<{ id: string; name: string; email: string; role: string; status: string; session_version: number }[]>`
      select id, name, email, role, status, coalesce(session_version, 0) as session_version
      from users where id = ${claims.id} limit 1`
    const u = rows[0]
    if (!u) return null                                   // deleted
    if (u.status !== 'ACTIVE') return null                // disabled
    if (Number(u.session_version) !== Number(claims.sv)) return null // password changed / revoked
    if (!isRole(u.role)) return null
    // Role comes from the DB, never from the token.
    return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status }
  } catch {
    return null
  }
}

export class AuthzError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status; this.name = 'AuthzError' }
}

/** Returns the user or throws AuthzError(401). */
export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser()
  if (!u) throw new AuthzError('Unauthorized', 401)
  return u
}

/** Returns the user or throws AuthzError(401/403). */
export async function requirePermission(perm: Permission): Promise<CurrentUser> {
  const u = await requireUser()
  if (!hasPermission(u.role, perm)) throw new AuthzError('You do not have permission to perform this action.', 403)
  return u
}

/** Wraps a route handler with uniform auth error handling. */
export function authzResponse(e: unknown): Response | null {
  if (e instanceof AuthzError) {
    return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { 'Content-Type': 'application/json' } })
  }
  return null
}

/**
 * Wraps a route handler with a permission check and uniform error mapping,
 * so a failed check returns 401/403 JSON instead of an unhandled 500.
 */
export function guarded(
  perm: Permission,
  handler: (req: Request, actor: CurrentUser) => Promise<Response>,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const actor = await requirePermission(perm)
      return await handler(req, actor)
    } catch (e) {
      const mapped = authzResponse(e)
      if (mapped) return mapped
      console.error('route error:', e instanceof Error ? e.message : e)
      return new Response(JSON.stringify({ error: 'Request failed.' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  }
}

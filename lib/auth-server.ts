import { getSql } from './db'
import { getSessionClaims } from './session'
import { validateSession, touchSession, needsTouch } from './sessions'
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

    // The individual session must still exist, belong to this user, and be
    // neither revoked nor expired. Account-wide session_version remains the
    // emergency revocation mechanism above.
    const session = await validateSession(claims.sid, u.id)
    if (!session) return null
    // Decide from the row we already have, so no UPDATE is issued on a normal
    // request. When the window has passed we AWAIT the write: fire-and-forget
    // work is not guaranteed to finish on serverless. The UPDATE repeats the
    // threshold in its WHERE clause, so concurrent requests cannot double-write.
    if (needsTouch(session)) {
      try { await touchSession(claims.sid) } catch { /* last_seen_at is best effort */ }
    }
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

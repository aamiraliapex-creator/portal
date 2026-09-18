import crypto from 'node:crypto'
import { getSql } from './db'

/** Sessions live as long as the JWT: 8 hours. */
export const SESSION_TTL_HOURS = 8
/** last_seen_at is refreshed at most this often, to avoid a write per request. */
export const LAST_SEEN_THROTTLE_MINUTES = 5
/** Revoked/expired rows older than this are pruned. */
export const SESSION_RETENTION_DAYS = 30

export type SessionRow = {
  id: string
  user_id: string
  created_at: Date
  last_seen_at: Date
  expires_at: Date
  revoked_at: Date | null
  user_agent: string | null
  device: string | null
  ip_prefix: string | null
}

/** Opaque, cryptographically random session identifier. Never a token. */
const newSessionKey = () => crypto.randomBytes(32).toString('base64url')

/** Coarse device label from a User-Agent. Best effort, purely informational. */
export function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : 'Unknown OS'
  return `${browser} on ${os}`
}

/**
 * Privacy-safe representation of the caller's address: IPv4 keeps the first
 * three octets, IPv6 the first three groups. The full address is never stored.
 */
export function ipPrefix(raw: string | null): string | null {
  if (!raw) return null
  const ip = raw.split(',')[0].trim().slice(0, 64)
  if (!ip) return null
  if (ip.includes('.')) {
    const p = ip.split('.')
    return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.x` : null
  }
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::x'
  return null
}

/** Creates a session row and returns its opaque key for embedding in the JWT. */
export async function createUserSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<{ sessionKey: string; id: string }> {
  const sql = getSql()
  const key = newSessionKey()
  const ua = (meta.userAgent || '').slice(0, 500) || null
  const [row] = await sql<{ id: string }[]>`
    insert into user_sessions (user_id, session_key, expires_at, user_agent, device, ip_prefix)
    values (${userId}, ${key}, now() + (${SESSION_TTL_HOURS} || ' hours')::interval,
            ${ua}, ${describeDevice(ua)}, ${ipPrefix(meta.ip ?? null)})
    returning id`
  return { sessionKey: key, id: row.id }
}

/**
 * Confirms the session exists, belongs to the user, and is neither revoked nor
 * expired. Returns null otherwise, so the caller fails closed.
 */
export async function validateSession(sessionKey: string, userId: string): Promise<SessionRow | null> {
  if (!sessionKey) return null
  const sql = getSql()
  const [row] = await sql<SessionRow[]>`
    select id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, device, ip_prefix
      from user_sessions
     where session_key = ${sessionKey}
       and user_id = ${userId}
       and revoked_at is null
       and expires_at > now()
     limit 1`
  return row ?? null
}

/**
 * True when the row we already loaded during validation is older than the
 * throttle window. Lets the caller skip the UPDATE entirely on the vast
 * majority of requests, without an extra read.
 */
export function needsTouch(session: Pick<SessionRow, 'last_seen_at'>): boolean {
  const last = new Date(session.last_seen_at).getTime()
  return Number.isFinite(last) && Date.now() - last >= LAST_SEEN_THROTTLE_MINUTES * 60_000
}

/**
 * Refreshes last_seen_at. The WHERE clause repeats the threshold, so two
 * concurrent requests cannot both write: the second matches zero rows.
 * Callers await this, because fire-and-forget work is not guaranteed to
 * complete on serverless platforms.
 */
export async function touchSession(sessionKey: string): Promise<void> {
  const sql = getSql()
  await sql`
    update user_sessions set last_seen_at = now()
     where session_key = ${sessionKey}
       and revoked_at is null
       and last_seen_at < now() - (${LAST_SEEN_THROTTLE_MINUTES} || ' minutes')::interval`
}

/** Revokes one session, but only if it belongs to this user. */
export async function revokeOwnSession(userId: string, sessionId: string): Promise<boolean> {
  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    update user_sessions set revoked_at = now()
     where id = ${sessionId} and user_id = ${userId} and revoked_at is null
    returning id`
  return rows.length > 0
}

/** Revokes every session for a user except the one identified by sessionKey. */
export async function revokeOtherSessions(userId: string, keepSessionKey: string): Promise<number> {
  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    update user_sessions set revoked_at = now()
     where user_id = ${userId} and revoked_at is null and session_key <> ${keepSessionKey}
    returning id`
  return rows.length
}

/** Revokes every session for a user, including the current one. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    update user_sessions set revoked_at = now()
     where user_id = ${userId} and revoked_at is null
    returning id`
  return rows.length
}

export async function revokeSessionByKey(sessionKey: string): Promise<void> {
  const sql = getSql()
  await sql`update user_sessions set revoked_at = now() where session_key = ${sessionKey} and revoked_at is null`
}

/** Sessions a user may see, newest first. Never exposes session_key. */
export async function listUserSessions(userId: string): Promise<SessionRow[]> {
  const sql = getSql()
  return sql<SessionRow[]>`
    select id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, device, ip_prefix
      from user_sessions
     where user_id = ${userId} and revoked_at is null and expires_at > now()
     order by created_at desc limit 50`
}

/** Removes long-dead rows. Called opportunistically on sign-in. */
export async function pruneSessions(): Promise<void> {
  const sql = getSql()
  await sql`
    delete from user_sessions
     where (expires_at < now() - (${SESSION_RETENTION_DAYS} || ' days')::interval)
        or (revoked_at is not null and revoked_at < now() - (${SESSION_RETENTION_DAYS} || ' days')::interval)`
}

import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { authSecretKey } from './env'

const COOKIE = 'clp_session'
export const SESSION_COOKIE = COOKIE

/** Claims embedded in the JWT. `sv` is the session version used for revocation. */
export type SessionClaims = { id: string; name: string; email: string; role: string; sv: number; sid: string }

export async function createSession(user: SessionClaims) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(authSecretKey())
  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  })
}

/** Verifies signature/expiry only. Does NOT prove the account is still active. */
export async function readToken(token?: string): Promise<SessionClaims | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, authSecretKey())
    if (!payload.id) return null
    return {
      id: String(payload.id),
      name: String(payload.name ?? ''),
      email: String(payload.email ?? ''),
      role: String(payload.role ?? ''),
      sv: Number(payload.sv ?? 0),
      sid: String(payload.sid ?? ''),
    }
  } catch {
    return null
  }
}

/**
 * Token-only claims. Kept for internal use; prefer getCurrentUser() from
 * lib/auth-server.ts for anything that authorises an action, because claims
 * are stale after disable/delete/role-change/password-change.
 */
export async function getSessionClaims(): Promise<SessionClaims | null> {
  const jar = await cookies()
  return readToken(jar.get(COOKIE)?.value)
}

export async function clearSession() {
  const jar = await cookies()
  jar.set(COOKIE, '', { path: '/', maxAge: 0 })
}

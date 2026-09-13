import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const COOKIE = 'clp_session'

// AUTH_SECRET must be set in production. We never silently sign/verify sessions with a
// publicly-known fallback in production — that would let anyone forge a valid session token.
// In local development only, we fall back to a clearly-marked insecure secret so `next dev`
// keeps working out of the box, and we warn loudly so it's never mistaken for a real config.
let warned = false
function secret() {
  const s = process.env.AUTH_SECRET
  if (s && s.length >= 16) return new TextEncoder().encode(s)
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SECRET is not set (or is too short). Set a strong random AUTH_SECRET (32+ bytes, e.g. `openssl rand -base64 32`) ' +
      'in your production environment before serving traffic. Refusing to start with an insecure default.'
    )
  }
  if (!warned) { console.warn('[security] AUTH_SECRET is not set — using an insecure development-only secret. Never deploy this to production.'); warned = true }
  return new TextEncoder().encode('dev-only-insecure-secret-DO-NOT-USE-IN-PRODUCTION-32B')
}

export type SessionUser = { id: string; name: string; email: string; role: string; tokenVersion: number }

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ id: user.id, name: user.name, email: user.email, role: user.role, tv: user.tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret())
  const store = await cookies()
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  })
}

export async function readToken(token?: string): Promise<SessionUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    return {
      id: String(payload.id),
      name: String(payload.name),
      email: String(payload.email),
      role: String(payload.role),
      tokenVersion: Number(payload.tv ?? 0),
    }
  } catch {
    return null
  }
}

// Cheap, stateless check of "is this a well-formed, signed, unexpired token" — this is what
// middleware uses for a fast edge-side redirect. It intentionally does NOT reflect whether the
// account has since been disabled, deleted, or had its password changed. For any authorization
// decision (not just "are you logged in"), use `getCurrentUser()` from lib/authz.ts instead,
// which re-checks the database on every call.
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies()
  return readToken(store.get(COOKIE)?.value)
}

export async function clearSession() {
  const store = await cookies()
  store.set(COOKIE, '', { path: '/', maxAge: 0 })
}

export const SESSION_COOKIE = COOKIE
export const isSuperAdmin = (u: SessionUser | null) => u?.role === 'SUPER_ADMIN'

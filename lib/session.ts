import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const COOKIE = 'clp_session'
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-insecure-secret-change-me')

export type SessionUser = { id: string; name: string; email: string; role: string }

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret())
  cookies().set(COOKIE, token, {
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
    return { id: String(payload.id), name: String(payload.name), email: String(payload.email), role: String(payload.role) }
  } catch {
    return null
  }
}

export async function getSession(): Promise<SessionUser | null> {
  return readToken(cookies().get(COOKIE)?.value)
}

export function clearSession() {
  cookies().set(COOKIE, '', { path: '/', maxAge: 0 })
}

export const SESSION_COOKIE = COOKIE
export const isSuperAdmin = (u: SessionUser | null) => u?.role === 'SUPER_ADMIN'

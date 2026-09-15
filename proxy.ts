import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { hasAuthSecret, authSecretKey } from '@/lib/env'
import { SESSION_COOKIE } from '@/lib/session'

/**
 * Network-boundary guard (Next.js 16 `proxy` convention, formerly middleware).
 *
 * This is a cheap first gate only: it proves the cookie is a well-formed,
 * unexpired JWT. Authorisation and account-status checks are enforced again
 * server-side in the (app) layout and in every API route via getCurrentUser().
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // API routes answer with JSON 401/403 themselves; never redirect them to HTML.
  if (pathname.startsWith('/api')) return NextResponse.next()
  if (pathname === '/login') return NextResponse.next()

  // Fail closed: without a configured secret we cannot verify anyone.
  if (!hasAuthSecret()) {
    return new NextResponse('Server is not configured (AUTH_SECRET missing).', { status: 503 })
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  let ok = false
  if (token) { try { await jwtVerify(token, authSecretKey()); ok = true } catch { ok = false } }
  if (!ok) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth|logo\\.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map)$).*)'] }

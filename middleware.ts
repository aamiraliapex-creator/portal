import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// Must match the fallback/validation logic in lib/session.ts exactly, or tokens signed
// server-side won't verify here (or vice versa). See lib/session.ts for the rationale.
function secret() {
  const s = process.env.AUTH_SECRET
  if (s && s.length >= 16) return new TextEncoder().encode(s)
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is not set (or is too short). Refusing to serve requests with an insecure default in production.')
  }
  return new TextEncoder().encode('dev-only-insecure-secret-DO-NOT-USE-IN-PRODUCTION-32B')
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  // API routes guard themselves (return JSON 401/403 with a DB-verified check); don't redirect them to HTML login
  if (pathname.startsWith('/api')) return NextResponse.next()
  // Public pages
  if (pathname === '/login') return NextResponse.next()

  // Fast, edge-side check that this is at minimum a well-formed, signed, unexpired token.
  // NOTE: this does NOT confirm the account is still active or that the password hasn't
  // changed since — that authoritative, database-backed check happens in the (app) layout
  // via getCurrentUser() (lib/authz.ts), which runs on every page under it. This two-layer
  // approach keeps the edge check fast (no DB call from Edge middleware) while still making
  // sure every actual page load is validated against current account state.
  const token = req.cookies.get('clp_session')?.value
  let ok = false
  if (token) { try { await jwtVerify(token, secret()); ok = true } catch { ok = false } }
  if (!ok) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth|logo\\.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map)$).*)'] }

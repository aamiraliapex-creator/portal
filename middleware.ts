import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-insecure-secret-change-me')

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  // API routes guard themselves (return JSON 401); don't redirect them to HTML login
  if (pathname.startsWith('/api')) return NextResponse.next()
  // Public pages
  if (pathname === '/login') return NextResponse.next()

  // Everything else requires a valid session
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

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'] }

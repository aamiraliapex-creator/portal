import { NextResponse } from 'next/server'
import { clearSession, getSessionClaims } from '@/lib/session'
import { revokeSessionByKey } from '@/lib/sessions'
export const runtime = 'nodejs'

export async function POST() {
  // Revoke server-side FIRST: clearing the cookie alone would leave a usable
  // session behind if the token had already been copied. clearSession() must
  // also be awaited, or the cookie may not be cleared at all.
  const claims = await getSessionClaims()
  if (claims?.sid) {
    try { await revokeSessionByKey(claims.sid) } catch { /* still clear the cookie */ }
  }
  await clearSession()
  return NextResponse.json({ ok: true })
}

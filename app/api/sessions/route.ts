import { NextResponse } from 'next/server'
import { requireUser, authzResponse } from '@/lib/auth-server'
import { getSessionClaims, clearSession } from '@/lib/session'
import { revokeOwnSession, revokeOtherSessions, revokeAllSessions } from '@/lib/sessions'
export const runtime = 'nodejs'

const ACTIONS = ['revoke', 'revoke-others', 'revoke-all'] as const
const MAX_ID = 200

/**
 * Session management for the signed-in user only. Every action is scoped to
 * the authenticated user id, so changing an id in the request body can never
 * reach another account's session.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser()
    const claims = await getSessionClaims()
    if (!claims?.sid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await req.json().catch(() => ({}))
    const action = b?.action
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }

    if (action === 'revoke') {
      const sessionId = typeof b.sessionId === 'string' ? b.sessionId.trim() : ''
      if (!sessionId || sessionId.length > MAX_ID) {
        return NextResponse.json({ error: 'A session id is required.' }, { status: 400 })
      }
      // Ownership is inside the UPDATE predicate: another user's id matches
      // nothing and returns the same neutral 404 as an unknown id.
      const ok = await revokeOwnSession(me.id, sessionId)
      if (!ok) return NextResponse.json({ error: 'Not available' }, { status: 404 })
      return NextResponse.json({ ok: true })
    }

    if (action === 'revoke-others') {
      const count = await revokeOtherSessions(me.id, claims.sid)
      return NextResponse.json({ ok: true, revoked: count })
    }

    const count = await revokeAllSessions(me.id)
    // The current device is signed out too, so clear its cookie before replying.
    await clearSession()
    return NextResponse.json({ ok: true, revoked: count, signedOut: true })
  } catch (e) {
    return authzResponse(e) ?? NextResponse.json({ error: 'Request failed.' }, { status: 500 })
  }
}

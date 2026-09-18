import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth-server'
import { getSessionClaims } from '@/lib/session'
import { listUserSessions, validateSession } from '@/lib/sessions'
import ProfileForm from './ProfileForm'
import SessionList from './SessionList'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function Profile() {
  const s = await getCurrentUser()
  if (!s) redirect('/login')

  const claims = await getSessionClaims()
  const currentSession = claims?.sid ? await validateSession(claims.sid, s.id) : null
  const rows = await listUserSessions(s.id)
  const sessions = rows.map((r) => ({
    id: r.id,
    device: r.device,
    ip_prefix: r.ip_prefix,
    created_at: new Date(r.created_at).toISOString(),
    last_seen_at: new Date(r.last_seen_at).toISOString(),
    expires_at: new Date(r.expires_at).toISOString(),
    current: !!currentSession && currentSession.id === r.id,
  }))

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">My Profile</h1>
      <ProfileForm name={s.name} email={s.email} role={s.role} />
      <SessionList sessions={sessions} />
    </div>
  )
}

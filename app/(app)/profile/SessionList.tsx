'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type SessionItem = {
  id: string
  device: string | null
  ip_prefix: string | null
  created_at: string
  last_seen_at: string
  expires_at: string
  current: boolean
}

const when = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function SessionList({ sessions }: { sessions: SessionItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function act(action: string, sessionId?: string) {
    setBusy(true); setMsg('')
    const res = await fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sessionId }),
    })
    setBusy(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setMsg(data.error || 'Could not update sessions.'); return }
    if (data.signedOut) { window.location.href = '/login'; return }
    router.refresh()
  }

  return (
    <div className="card mt-6 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Sessions &amp; devices</h2>
          <p className="text-xs text-slate-500">Where your account is currently signed in.</p>
        </div>
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => act('revoke-others')} className="chip">Sign out other devices</button>
          <button disabled={busy} onClick={() => act('revoke-all')} className="chip text-brand-700">Sign out everywhere</button>
        </div>
      </div>
      {msg && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{msg}</p>}
      <div className="mt-4 divide-y divide-slate-100">
        {sessions.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No active sessions.</p>}
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-4 py-3 text-sm">
            <div className="flex-1">
              <p className="font-medium text-slate-800">
                {s.device || 'Unknown device'}
                {s.current && <span className="badge ml-2 bg-emerald-50 text-emerald-700">This device</span>}
              </p>
              <p className="text-xs text-slate-500">
                {s.ip_prefix ? `IP ${s.ip_prefix} · ` : ''}Signed in {when(s.created_at)} · Last active {when(s.last_seen_at)} · Expires {when(s.expires_at)}
              </p>
            </div>
            {!s.current && (
              <button disabled={busy} onClick={() => act('revoke', s.id)} className="chip text-brand-700">Revoke</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

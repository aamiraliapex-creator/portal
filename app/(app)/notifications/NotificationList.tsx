'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type Item = {
  id: string; type: string; priority: string; title: string; message: string
  action_url: string | null; event_at: string | null; scheduled_for: string
  read_at: string | null; acknowledged_at: string | null
}

const LABEL: Record<string, string> = { hearing: 'Hearing', task: 'Task', payment: 'Payment', document: 'Document' }
const when = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function NotificationList({ items }: { items: Item[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(action: string, id?: string) {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Action failed.')
      } else router.refresh()
    } catch { setError('Action failed.') } finally { setBusy(false) }
  }

  return (
    <div className="card mt-4">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Your notifications</h2>
        <button disabled={busy} onClick={() => act('read-all')} className="chip">Mark all read</button>
      </div>
      {error && <p role="alert" className="px-5 py-2 text-sm text-brand-700">{error}</p>}
      <div className="divide-y divide-slate-50">
        {items.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">Nothing to show.</p>}
        {items.map((n) => {
          const needsAck = n.priority === 'critical' && !n.acknowledged_at
          return (
            <div key={n.id} className={'px-5 py-4 text-sm ' + (needsAck ? 'bg-brand-50/60' : !n.read_at ? 'bg-slate-50' : '')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge bg-slate-100 text-slate-600">{LABEL[n.type] || n.type}</span>
                <p className="font-medium text-slate-800">{n.title}</p>
                {needsAck && <span className="badge bg-brand-100 text-brand-700">Needs acknowledgement</span>}
                {!n.read_at && !needsAck && <span className="badge bg-slate-100 text-slate-600">Unread</span>}
              </div>
              <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{n.message}</p>
              {n.message.includes('TIMEZONE NEEDS REVIEW') && (
                <p role="alert" className="mt-1 text-[11px] font-semibold text-brand-700">Verify the court timezone immediately.</p>
              )}
              <p className="mt-1 text-[11px] text-slate-400">Sent {when(n.scheduled_for)}</p>
              {n.acknowledged_at && (
                <p className="text-[11px] text-emerald-700">Acknowledged {when(n.acknowledged_at)}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {n.action_url && <a href={n.action_url} className="chip">Open</a>}
                {needsAck && <button disabled={busy} onClick={() => act('acknowledge', n.id)} className="chip text-brand-700">Acknowledge</button>}
                {!n.read_at && <button disabled={busy} onClick={() => act('read', n.id)} className="chip">Mark read</button>}
                {!needsAck && <button disabled={busy} onClick={() => act('dismiss', n.id)} className="chip">Dismiss</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

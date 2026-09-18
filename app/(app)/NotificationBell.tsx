'use client'
import { useCallback, useEffect, useState } from 'react'

type Item = {
  id: string; type: string; priority: string; title: string; message: string
  action_url: string | null; read_at: string | null; acknowledged_at: string | null
  scheduled_for: string
}

const ICON: Record<string, string> = { hearing: '⚖', task: '✓', payment: '$', document: '▤' }

export default function NotificationBell() {
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [critical, setCritical] = useState(0)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) { setError('Could not load notifications.'); return }
      const d = await res.json()
      setItems(d.items || []); setUnread(d.unread || 0); setCritical(d.criticalUnacknowledged || 0)
      setError('')
    } catch { setError('Could not load notifications.') }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  async function act(action: string, id?: string) {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Action failed.')
        return
      }
      setError(''); load()
    } catch { setError('Action failed.') }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications: ${unread} unread${critical ? `, ${critical} needing acknowledgement` : ''}`}
        aria-expanded={open}
        className="relative rounded-full p-2 hover:bg-slate-100"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className={'absolute -right-0.5 -top-0.5 rounded-full px-1.5 text-[10px] font-bold text-white ' + (critical > 0 ? 'bg-brand-600' : 'bg-slate-500')}>
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-50 mt-2 w-96 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <p className="text-sm font-semibold text-slate-700">Notifications</p>
            <button onClick={() => act('read-all')} className="text-xs font-semibold text-brand-600">Mark all read</button>
          </div>
          {error && <p role="alert" className="px-4 py-2 text-xs text-brand-700">{error}</p>}
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
            {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing to show.</p>}
            {items.map((n) => {
              const needsAck = n.priority === 'critical' && !n.acknowledged_at
              return (
                <div key={n.id} className={'px-4 py-3 text-sm ' + (needsAck ? 'bg-brand-50/60' : !n.read_at ? 'bg-slate-50' : '')}>
                  <div className="flex items-start gap-2">
                    <span aria-hidden="true">{ICON[n.type] || '•'}</span>
                    <div className="flex-1">
                      <p className="font-medium text-slate-800">
                        {n.title}
                        {needsAck && <span className="badge ml-2 bg-brand-100 text-brand-700">Needs acknowledgement</span>}
                        {!n.read_at && !needsAck && <span className="badge ml-2 bg-slate-100 text-slate-600">Unread</span>}
                      </p>
                      <p className="whitespace-pre-line text-xs text-slate-600">{n.message}</p>
                      {n.message.includes('TIMEZONE NEEDS REVIEW') && (
                        <p role="alert" className="mt-1 text-[11px] font-semibold text-brand-700">Verify the court timezone immediately.</p>
                      )}
                      {n.acknowledged_at && (
                        <p className="mt-1 text-[11px] text-emerald-700">
                          Acknowledged {new Date(n.acknowledged_at).toLocaleString()}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {n.action_url && <a href={n.action_url} className="chip">Open</a>}
                        {needsAck && <button onClick={() => act('acknowledge', n.id)} className="chip text-brand-700">Acknowledge</button>}
                        {!n.read_at && <button onClick={() => act('read', n.id)} className="chip">Mark read</button>}
                        {!needsAck && <button onClick={() => act('dismiss', n.id)} className="chip">Dismiss</button>}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

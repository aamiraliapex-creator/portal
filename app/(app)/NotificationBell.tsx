'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
type Item = { title: string; body: string; href: string; tone: string }
export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { fetch('/api/notifications').then((r) => r.json()).then((d) => setItems(d.items || [])).catch(() => {}) }, [])
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
        <span className="text-lg">🔔</span>
        {items.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{items.length > 99 ? '99+' : items.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-96 max-w-[92vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <span className="text-xs font-semibold text-brand-600">{items.length} new</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="p-8 text-center text-sm text-slate-500">You&apos;re all caught up.</p>}
            {items.map((n, i) => (
              <Link key={i} href={n.href} onClick={() => setOpen(false)} className="flex gap-3 border-b border-slate-50 px-4 py-3 hover:bg-slate-50">
                <span className={'mt-1 inline-block h-2 w-2 shrink-0 rounded-full ' + (n.tone === 'rose' ? 'bg-brand-600' : 'bg-gold-500')} />
                <div><p className="text-sm font-medium text-slate-800">{n.title}</p><p className="text-xs text-slate-500">{n.body}</p></div>
              </Link>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-semibold text-brand-600 hover:bg-slate-50">View all notifications</Link>
        </div>
      )}
    </div>
  )
}

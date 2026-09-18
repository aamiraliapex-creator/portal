'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Authorized inline control to set, change or clear a document expiry date. */
export default function ExpiryEditor({ id, value }: { id: string; value: string | null }) {
  const router = useRouter()
  const [date, setDate] = useState(value ? new Date(value).toISOString().slice(0, 10) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(next: string) {
    setBusy(true); setError('')
    const res = await fetch('/api/documents', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, expiresOn: next }),
    })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not save.')
      return
    }
    setDate(next); router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`exp-${id}`}>Expiry date</label>
      <input
        id={`exp-${id}`} type="date" value={date} disabled={busy}
        onChange={(e) => setDate(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <button disabled={busy} onClick={() => save(date)} className="chip">Save</button>
      {date && <button disabled={busy} onClick={() => save('')} className="chip">Clear</button>}
      {error && <span role="alert" className="text-[11px] text-brand-700">{error}</span>}
    </div>
  )
}

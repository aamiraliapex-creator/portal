'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { stateToTz, utcToLocalInputValue, localInputToUtcIso } from '@/lib/timezones'

type CaseRow = {
  id: string; citation: string | null; official_no: string | null; court: string | null; state: string | null;
  status: string; hearing_at: string | null; hearing_tz: string | null; hearing_type: string; prep_status: string;
  customer_id: string; first_name: string; last_name: string
}

export default function HearingForm({ caseRow }: { caseRow: CaseRow }) {
  const router = useRouter()
  const tz = caseRow.hearing_tz || stateToTz(caseRow.state)
  const [f, setF] = useState({
    hearingAt: caseRow.hearing_at ? utcToLocalInputValue(caseRow.hearing_at, tz) : '',
    hearingType: caseRow.hearing_type || 'In person',
    prepStatus: caseRow.prep_status || 'Not started',
    status: caseRow.status || 'Hearing Scheduled',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSaving(true)
    const hearingAt = f.hearingAt ? localInputToUtcIso(f.hearingAt, tz) : null
    const res = await fetch('/api/hearings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: caseRow.id, hearingAt, hearingType: f.hearingType, prepStatus: f.prepStatus, status: f.status, state: caseRow.state }),
    })
    setSaving(false)
    if (res.ok) { router.push('/hearings'); router.refresh() } else { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save.') }
  }

  return (
    <div className="max-w-2xl">
      <button onClick={() => router.push('/hearings')} className="text-sm text-brand-600">← Back to hearings</button>
      <h1 className="mt-1 text-xl font-bold text-slate-900">Schedule hearing</h1>
      <p className="text-sm text-slate-500">
        {caseRow.first_name} {caseRow.last_name} · {caseRow.citation || caseRow.official_no || '—'} · {caseRow.court || 'Court not set'}
      </p>
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="card p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <span className="lbl">Hearing date &amp; time (court-local, {tz.split('/').pop()?.replace('_', ' ')})</span>
              <input type="datetime-local" value={f.hearingAt} onChange={(e) => set('hearingAt', e.target.value)} className="inp" />
            </div>
            <div>
              <span className="lbl">Type</span>
              <select value={f.hearingType} onChange={(e) => set('hearingType', e.target.value)} className="inp">
                <option>In person</option><option>Zoom</option><option>Phone</option>
              </select>
            </div>
            <div>
              <span className="lbl">Prep status</span>
              <select value={f.prepStatus} onChange={(e) => set('prepStatus', e.target.value)} className="inp">
                <option>Not started</option><option>In progress</option><option>Ready</option>
              </select>
            </div>
            <div>
              <span className="lbl">Status</span>
              <select value={f.status} onChange={(e) => set('status', e.target.value)} className="inp">
                <option>Hearing Scheduled</option><option>Waiting for Court</option><option>Resolved</option><option>Dismissed</option>
              </select>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">Court timezone is inferred from the case's state ({caseRow.state || 'not set'}). Update the case's state to change it.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.push('/hearings')} className="btn btn-ghost">Cancel</button>
          <button disabled={saving} className="btn btn-red">{saving ? 'Saving…' : 'Save hearing'}</button>
        </div>
      </form>
    </div>
  )
}

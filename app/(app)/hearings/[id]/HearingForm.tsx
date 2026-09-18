'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { stateToTzStrict, utcToLocalInputValue, localInputToUtcIso } from '@/lib/timezones'
import CourtTimezoneSelect from '../../CourtTimezoneSelect'
import { TZ_REVIEW_WARNING, resolveHearingTzDetailed, initialSelectorTz, applyTimezoneChange } from '@/lib/hearing-time'

type CaseRow = {
  id: string; citation: string | null; official_no: string | null; court: string | null; state: string | null;
  status: string; hearing_at: string | null; hearing_tz: string | null; hearing_type: string; prep_status: string;
  customer_id: string; first_name: string; last_name: string
}

export default function HearingForm({ caseRow }: { caseRow: CaseRow }) {
  const router = useRouter()
  // Strict resolution: an unresolvable zone shows UTC plus a warning rather
  // than a plausible Pacific time.
  const resolution = resolveHearingTzDetailed(caseRow.hearing_tz, caseRow.state)
  const initialTz = resolution.tz
  const [f, setF] = useState({
    // An INVALID legacy zone is never loaded into the controlled selector: it
    // starts blank, the review warning shows, and a valid choice is required
    // before saving. A valid stored zone is preserved exactly.
    hearingTz: initialSelectorTz(caseRow.hearing_tz),
    hearingAt: caseRow.hearing_at ? utcToLocalInputValue(caseRow.hearing_at, initialTz) : '',
    hearingType: caseRow.hearing_type || 'In person',
    prepStatus: caseRow.prep_status || 'Not started',
    status: caseRow.status || 'Hearing Scheduled',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Tracks whether the user has typed into the date/time field, so a later
  // timezone change never overwrites their edit with the database value.
  const [manuallyEdited, setManuallyEdited] = useState(false)
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))
  const setHearingAt = (v: string) => { setManuallyEdited(true); set('hearingAt', v) }

  function changeTimezone(next: string) {
    // Preserves a manual edit; otherwise re-renders the ORIGINAL stored instant
    // in the newly selected zone (repeatable without drift).
    setF((s) => ({
      ...s,
      ...applyTimezoneChange({ hearingAt: s.hearingAt, dateTimeEdited: manuallyEdited }, caseRow.hearing_at, next),
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSaving(true)
    // Convert the local input using the SELECTED court timezone, never a
    // Pacific fallback. An unchanged selector keeps the stored zone.
    // With an unresolvable stored zone the selector is blank and a valid
    // selection is mandatory before a court date can be saved.
    const courtTz = f.hearingTz || (resolution.needsReview ? '' : stateToTzStrict(caseRow.state) || '')
    if (f.hearingAt && !courtTz) {
      setSaving(false)
      setError('Select a court timezone for this hearing date.')
      return
    }
    const hearingAt = f.hearingAt ? localInputToUtcIso(f.hearingAt, courtTz) : null
    const res = await fetch('/api/hearings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: caseRow.id, hearingAt, hearingTz: courtTz,
        hearingType: f.hearingType, prepStatus: f.prepStatus, status: f.status, state: caseRow.state,
      }),
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
              <span className="lbl">Hearing date &amp; time (court-local, {(f.hearingTz || initialTz).split('/').pop()?.replace('_', ' ')})</span>
              <input type="datetime-local" value={f.hearingAt} onChange={(e) => setHearingAt(e.target.value)} className="inp" />
            </div>
        <CourtTimezoneSelect value={f.hearingTz} onChange={changeTimezone} suggested={stateToTzStrict(caseRow.state)} />
        {resolution.needsReview && <p className="mt-1 text-[11px] font-semibold text-brand-700">{TZ_REVIEW_WARNING}</p>}
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
          <p className="mt-3 text-xs text-slate-400">A recognised state only suggests a court timezone. Change it with the selector above at any time — editing the case state is not required.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.push('/hearings')} className="btn btn-ghost">Cancel</button>
          <button disabled={saving} className="btn btn-red">{saving ? 'Saving…' : 'Save hearing'}</button>
        </div>
      </form>
    </div>
  )
}

'use client'

/**
 * Explicit court-timezone selector. A state suggests a zone, but several US
 * states span more than one, so the user can always correct it. The server
 * validates the value and never guesses Pacific.
 */
export const COURT_TIMEZONES = [
  ['America/New_York', 'Eastern (New York)'],
  ['America/Chicago', 'Central (Chicago)'],
  ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Mountain, no DST (Phoenix)'],
  ['America/Los_Angeles', 'Pacific (Los Angeles)'],
  ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'],
  ['America/Detroit', 'Eastern (Detroit)'],
  ['America/Boise', 'Mountain (Boise)'],
  ['America/Indiana/Indianapolis', 'Eastern (Indianapolis)'],
] as const

export default function CourtTimezoneSelect({
  value, onChange, suggested,
}: { value: string; onChange: (v: string) => void; suggested?: string | null }) {
  return (
    <div>
      <span className="lbl">Court timezone</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="inp">
        <option value="">
          {suggested ? `Use state default (${suggested})` : 'Select a court timezone…'}
        </option>
        {COURT_TIMEZONES.map(([tz, label]) => <option key={tz} value={tz}>{label}</option>)}
      </select>
      <p className="mt-1 text-[11px] text-slate-400">
        Required for a hearing date unless the state is recognised. Some states span two zones — change it here at any time; you do not need to edit the case state.
      </p>
    </div>
  )
}

export const dynamic = 'force-dynamic'
type H = { d: string; n: string; obs?: string }
const HOLIDAYS: H[] = [
  { d: '2026-01-01', n: "New Year's Day" }, { d: '2026-01-19', n: 'Martin Luther King, Jr. Day' },
  { d: '2026-02-16', n: "Washington's Birthday (Presidents' Day)" }, { d: '2026-05-25', n: 'Memorial Day' },
  { d: '2026-06-19', n: 'Juneteenth National Independence Day' }, { d: '2026-07-04', n: 'Independence Day', obs: '2026-07-03' },
  { d: '2026-09-07', n: 'Labor Day' }, { d: '2026-10-12', n: "Columbus Day / Indigenous Peoples' Day" },
  { d: '2026-11-11', n: 'Veterans Day' }, { d: '2026-11-26', n: 'Thanksgiving Day' }, { d: '2026-12-25', n: 'Christmas Day' },
  { d: '2027-01-01', n: "New Year's Day" }, { d: '2027-01-18', n: 'Martin Luther King, Jr. Day' },
  { d: '2027-02-15', n: "Washington's Birthday (Presidents' Day)" }, { d: '2027-05-31', n: 'Memorial Day' },
  { d: '2027-06-19', n: 'Juneteenth National Independence Day', obs: '2027-06-18' }, { d: '2027-07-04', n: 'Independence Day', obs: '2027-07-05' },
  { d: '2027-09-06', n: 'Labor Day' }, { d: '2027-10-11', n: "Columbus Day / Indigenous Peoples' Day" },
  { d: '2027-11-11', n: 'Veterans Day' }, { d: '2027-11-25', n: 'Thanksgiving Day' }, { d: '2027-12-25', n: 'Christmas Day', obs: '2027-12-24' },
]
const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const daysUntil = (d: string) => { const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth(), n.getDate()); return Math.round((new Date(d + 'T00:00:00').getTime() - t.getTime()) / 86400000) }

export default function Holidays() {
  const today = new Date(); const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
  const th = HOLIDAYS.find((h) => h.d === todayStr || h.obs === todayStr)
  const next = HOLIDAYS.filter((h) => (h.obs || h.d) >= todayStr).sort((a, b) => ((a.obs || a.d) < (b.obs || b.d) ? -1 : 1))[0]
  const years: Record<string, H[]> = {}; HOLIDAYS.forEach((h) => { (years[h.d.slice(0, 4)] ||= []).push(h) })
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">US Holidays</h1>
      <p className="text-sm text-slate-500">Official U.S. federal holidays.</p>
      {th ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-800">🎉 Today is {th.n}</p><p className="text-xs text-emerald-700">{fmt(th.d)}{th.obs ? ' · observed ' + fmt(th.obs) : ''}</p></div>
      ) : next ? (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4"><p className="text-sm font-semibold text-brand-700">Next holiday: {next.n}</p><p className="text-xs text-slate-600">{fmt(next.d)} · {daysUntil(next.obs || next.d)} days away{next.obs ? ' · observed ' + fmt(next.obs) : ''}</p></div>
      ) : null}
      <div className="mt-4 space-y-4">
        {Object.keys(years).sort().map((y) => (
          <div key={y}>
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{y}</p>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {years[y].map((h) => { const eff = h.obs || h.d; const isToday = h.d === todayStr || h.obs === todayStr; const du = daysUntil(eff); const past = du < 0 && !isToday
                return (
                  <div key={h.d} className={'flex items-center gap-3 border-b border-slate-50 px-4 py-3 ' + (isToday ? 'bg-emerald-50/50' : past ? 'opacity-60' : '')}>
                    <div className="w-56 shrink-0 text-sm text-slate-600">{fmt(h.d)}</div>
                    <div className="flex-1"><p className="text-sm font-medium text-slate-800">{h.n}</p>{h.obs ? <p className="text-[11px] text-slate-400">Observed {fmt(h.obs)}</p> : null}</div>
                    <span className="text-xs text-slate-500">{isToday ? 'Today' : du === 1 ? 'Tomorrow' : past ? 'Past' : 'In ' + du + ' days'}</span>
                  </div>
                ) })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

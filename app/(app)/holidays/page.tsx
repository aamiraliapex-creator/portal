import { HOLIDAYS, fmtHoliday, daysUntil, holidayToday, nextHoliday, todayStr } from '@/lib/holidays'
export const dynamic = 'force-dynamic'
export default function Holidays() {
  const t = todayStr(); const th = holidayToday(); const nx = nextHoliday()
  const years: Record<string, typeof HOLIDAYS> = {}; HOLIDAYS.forEach((h) => { (years[h.d.slice(0, 4)] ||= []).push(h) })
  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900">US Holidays</h1>
      <p className="text-sm text-slate-500">Official U.S. federal holidays.</p>
      {th ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-800">🎉 Today is {th.n}</p><p className="text-xs text-emerald-700">{fmtHoliday(th.d)}</p></div>
        : nx ? <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4"><p className="text-sm font-semibold text-brand-700">Next holiday: {nx.n}</p><p className="text-xs text-slate-600">{fmtHoliday(nx.d)} · {daysUntil(nx.obs || nx.d)} days away</p></div> : null}
      <div className="mt-4 space-y-4">
        {Object.keys(years).sort().map((y) => (
          <div key={y}><p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{y}</p>
            <div className="card overflow-hidden">
              {years[y].map((h) => { const eff = h.obs || h.d; const isToday = h.d === t || h.obs === t; const du = daysUntil(eff); const past = du < 0 && !isToday
                return <div key={h.d} className={'flex items-center gap-3 border-b border-slate-50 px-4 py-3 ' + (isToday ? 'bg-emerald-50/50' : past ? 'opacity-60' : '')}><div className="w-56 shrink-0 text-sm text-slate-600">{fmtHoliday(h.d)}</div><div className="flex-1"><p className="text-sm font-medium text-slate-800">{h.n}</p>{h.obs ? <p className="text-[11px] text-slate-400">Observed {fmtHoliday(h.obs)}</p> : null}</div><span className="text-xs text-slate-500">{isToday ? 'Today' : du === 1 ? 'Tomorrow' : past ? 'Past' : 'In ' + du + ' days'}</span></div> })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export type H = { d: string; n: string; obs?: string }
export const HOLIDAYS: H[] = [
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
export const fmtHoliday = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
export const daysUntil = (d: string) => { const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth(), n.getDate()); return Math.round((new Date(d + 'T00:00:00').getTime() - t.getTime()) / 86400000) }
export function todayStr() { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') }
export function holidayToday() { const t = todayStr(); return HOLIDAYS.find((h) => h.d === t || h.obs === t) || null }
export function nextHoliday() { const t = todayStr(); return HOLIDAYS.filter((h) => (h.obs || h.d) >= t).sort((a, b) => ((a.obs || a.d) < (b.obs || b.d) ? -1 : 1))[0] || null }

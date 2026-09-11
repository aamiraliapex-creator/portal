import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ev = { day: number; label: string; time: string | null; color: string }

export default async function Calendar({ searchParams }: { searchParams: { y?: string; m?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const now = new Date()
  const y = parseInt(searchParams.y || String(now.getFullYear()))
  const m = parseInt(searchParams.m ?? String(now.getMonth())) // 0-11
  const monthStart = new Date(y, m, 1)
  const monthEnd = new Date(y, m + 1, 1)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const cases = await sql<{ next_action: string | null; next_action_at: string; status: string; citation: string | null }[]>`
    select next_action, next_action_at, status, citation from cases where next_action_at >= ${iso(monthStart)}::date and next_action_at < ${iso(monthEnd)}::date`
  const tasks = await sql<{ title: string; due_at: string }[]>`
    select title, due_at from tasks where due_at >= ${iso(monthStart)}::date and due_at < ${iso(monthEnd)}::date and status in ('Open','In Progress')`

  const events: Ev[] = []
  cases.forEach((c) => { const dt = new Date(c.next_action_at); const isHearing = c.status === 'Hearing Scheduled'; events.push({ day: dt.getDate(), label: isHearing ? 'Hearing' : (c.next_action || 'Case'), time: dt.getHours() ? dt.toLocaleTimeString('en-US', { hour: 'numeric' }) : null, color: isHearing ? 'bg-sky-500' : 'bg-brand-600' }) })
  tasks.forEach((t) => { const dt = new Date(t.due_at); events.push({ day: dt.getDate(), label: t.title, time: null, color: 'bg-gold-500' }) })
  const byDay: Record<number, Ev[]> = {}; events.forEach((e) => { (byDay[e.day] ||= []).push(e) })

  const firstDow = monthStart.getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(day)
  while (cells.length % 7 !== 0) cells.push(null)

  const prev = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }
  const next = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }
  const monthName = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const today = new Date()
  const isToday = (day: number) => today.getFullYear() === y && today.getMonth() === m && today.getDate() === day

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900">Calendar</h1>
      <p className="text-sm text-slate-500">Hearings, deadlines and tasks in one view.</p>
      <div className="card mt-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{monthName}</h2>
          <div className="flex gap-2"><Link href={`/calendar?y=${prev.y}&m=${prev.m}`} className="chip">‹</Link><Link href={`/calendar?y=${next.y}&m=${next.m}`} className="chip">›</Link></div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="py-1">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => (
            <div key={i} className={'min-h-[90px] rounded-lg border p-1.5 ' + (day && isToday(day) ? 'border-brand-400 ring-1 ring-brand-200' : 'border-slate-100') + (day ? ' bg-white' : ' bg-slate-50/50')}>
              {day && <div className="text-xs font-medium text-slate-500">{day}</div>}
              <div className="mt-1 space-y-1">
                {(byDay[day || -1] || []).slice(0, 3).map((e, j) => (
                  <div key={j} className={'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ' + e.color}><span className="truncate">{e.label}</span>{e.time && <span className="ml-auto opacity-80">{e.time}</span>}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { stateToTz, tzAbbr } from '@/lib/timezones'
import { HOLIDAYS } from '@/lib/holidays'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ev = { day: number; label: string; sub?: string; time: string | null; kind: 'hearing' | 'deadline' | 'task' | 'holiday'; href?: string }

const KIND_STYLE: Record<Ev['kind'], { dot: string; pill: string; icon: string; label: string }> = {
  hearing: { dot: 'bg-sky-500', pill: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200', icon: '⚖', label: 'Hearing' },
  deadline: { dot: 'bg-brand-600', pill: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200', icon: '▤', label: 'Deadline' },
  task: { dot: 'bg-gold-500', pill: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200', icon: '✓', label: 'Task' },
  holiday: { dot: 'bg-violet-500', pill: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200', icon: '🎉', label: 'Holiday' },
}

export default async function Calendar({ searchParams }: { searchParams: { y?: string; m?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const now = new Date()
  const y = parseInt(searchParams.y || String(now.getFullYear()))
  const m = parseInt(searchParams.m ?? String(now.getMonth())) // 0-11
  const monthStart = new Date(y, m, 1)
  const monthEnd = new Date(y, m + 1, 1)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const cases = await sql<{ id: string; citation: string | null; official_no: string | null; court: string | null; state: string | null; status: string; hearing_at: string | null; hearing_tz: string | null; next_action: string | null; next_action_at: string | null }[]>`
    select id, citation, official_no, court, state, status, hearing_at, hearing_tz, next_action, next_action_at from cases
    where (hearing_at >= ${iso(monthStart)}::date and hearing_at < ${iso(monthEnd)}::date)
       or (hearing_at is null and next_action_at >= ${iso(monthStart)}::date and next_action_at < ${iso(monthEnd)}::date)`
  const tasks = await sql<{ title: string; due_at: string }[]>`
    select title, due_at from tasks where due_at >= ${iso(monthStart)}::date and due_at < ${iso(monthEnd)}::date and status in ('Open','In Progress')`

  const events: Ev[] = []
  cases.forEach((c) => {
    const isHearing = c.hearing_at != null || c.status === 'Hearing Scheduled'
    const anchor = c.hearing_at || c.next_action_at
    if (!anchor) return
    const tz = c.hearing_at ? (c.hearing_tz || stateToTz(c.state)) : undefined
    const dt = new Date(anchor)
    const day = tz ? parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(dt)) : dt.getDate()
    const time = tz
      ? `${new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: dt.getMinutes() ? '2-digit' : undefined, hour12: true }).format(dt)} ${tzAbbr(tz)}`
      : (dt.getHours() ? dt.toLocaleTimeString('en-US', { hour: 'numeric' }) : null)
    events.push({
      day, time,
      label: isHearing ? (c.citation || c.official_no || 'Hearing') : (c.next_action || 'Case'),
      sub: isHearing ? (c.court || undefined) : undefined,
      kind: isHearing ? 'hearing' : 'deadline',
    })
  })
  tasks.forEach((t) => { const dt = new Date(t.due_at); events.push({ day: dt.getDate(), label: t.title, time: null, kind: 'task' }) })
  HOLIDAYS.forEach((h) => {
    const d = h.obs || h.d
    const dt = new Date(d + 'T00:00:00')
    if (dt.getFullYear() === y && dt.getMonth() === m) events.push({ day: dt.getDate(), label: h.n, time: null, kind: 'holiday' })
  })
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
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m
  const isToday = (day: number) => isCurrentMonth && today.getDate() === day
  const isWeekend = (i: number) => i % 7 === 0 || i % 7 === 6

  // Agenda: everything from today onward across the next ~45 days, regardless of which month is displayed.
  const agendaEnd = new Date(); agendaEnd.setDate(agendaEnd.getDate() + 45)
  const agendaCases = await sql<{ id: string; citation: string | null; official_no: string | null; court: string | null; state: string | null; status: string; hearing_at: string | null; hearing_tz: string | null; next_action: string | null; next_action_at: string | null; first_name: string; last_name: string }[]>`
    select k.id, k.citation, k.official_no, k.court, k.state, k.status, k.hearing_at, k.hearing_tz, k.next_action, k.next_action_at, c.first_name, c.last_name
    from cases k join customers c on c.id = k.customer_id
    where coalesce(k.hearing_at, k.next_action_at) >= now() and coalesce(k.hearing_at, k.next_action_at) < ${iso(agendaEnd)}::date
    order by coalesce(k.hearing_at, k.next_action_at) asc limit 8`

  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Calendar</h1>
          <p className="text-sm text-slate-500">Hearings, deadlines, tasks and holidays in one view.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Object.values(KIND_STYLE).map((k) => (
            <span key={k.label} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className={'h-2 w-2 rounded-full ' + k.dot} />{k.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <div className="card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">{monthName}</h2>
            <div className="flex items-center gap-2">
              <Link href={`/calendar?y=${now.getFullYear()}&m=${now.getMonth()}`} className={'chip' + (isCurrentMonth ? ' active' : '')}>Today</Link>
              <Link href={`/calendar?y=${prev.y}&m=${prev.m}`} className="chip" aria-label="Previous month">‹</Link>
              <Link href={`/calendar?y=${next.y}&m=${next.m}`} className="chip" aria-label="Next month">›</Link>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-t-lg bg-slate-100 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="bg-slate-50 py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-b-lg border border-t-0 border-slate-100 bg-slate-100">
            {cells.map((day, i) => {
              const dayEvents = byDay[day || -1] || []
              const overflow = dayEvents.length - 3
              return (
                <div key={i} className={'min-h-[108px] p-1.5 sm:p-2 transition-colors ' + (day ? (isWeekend(i) ? 'bg-slate-50/60' : 'bg-white') + ' hover:bg-slate-50' : 'bg-slate-50/40')}>
                  {day && (
                    <div className="flex items-center justify-between">
                      <span className={'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ' + (isToday(day) ? 'bg-brand-600 text-white' : 'text-slate-600')}>{day}</span>
                    </div>
                  )}
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map((e, j) => {
                      const s = KIND_STYLE[e.kind]
                      return (
                        <div key={j} title={e.sub ? `${e.label} · ${e.sub}` : e.label} className={'flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium ' + s.pill}>
                          <span className="shrink-0">{s.icon}</span><span className="truncate">{e.label}</span>{e.time && <span className="ml-auto shrink-0 opacity-70">{e.time}</span>}
                        </div>
                      )
                    })}
                    {overflow > 0 && <div className="px-1.5 text-[10px] font-semibold text-slate-400">+{overflow} more</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Upcoming</h2>
          <p className="mt-0.5 text-xs text-slate-400">Next 45 days, across all months.</p>
          <div className="mt-3 space-y-3">
            {agendaCases.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Nothing on the horizon.</p>}
            {agendaCases.map((k) => {
              const isHearing = k.hearing_at != null || k.status === 'Hearing Scheduled'
              const anchor = k.hearing_at || k.next_action_at!
              const tz = k.hearing_at ? (k.hearing_tz || stateToTz(k.state)) : undefined
              const dt = new Date(anchor)
              const dateLabel = tz
                ? new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(dt)
                : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              const timeLabel = tz
                ? `${new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(dt)} ${tzAbbr(tz)}`
                : null
              const s = KIND_STYLE[isHearing ? 'hearing' : 'deadline']
              return (
                <Link key={k.id} href={isHearing ? `/hearings/${k.id}` : `/customers/${k.id}`} className="flex items-start gap-3 rounded-lg p-1.5 -mx-1.5 hover:bg-slate-50">
                  <div className="flex w-12 shrink-0 flex-col items-center rounded-md border border-slate-200 bg-white py-1">
                    <span className="text-[10px] font-semibold uppercase text-slate-400">{dateLabel.split(' ')[0]}</span>
                    <span className="text-sm font-bold text-slate-800">{dateLabel.split(' ')[1]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + s.dot} /><p className="truncate text-sm font-medium text-slate-800">{k.citation || k.official_no || k.next_action || 'Case'}</p></div>
                    <p className="truncate text-xs text-slate-500">{k.first_name} {k.last_name}{k.court ? ' · ' + k.court : ''}{timeLabel ? ' · ' + timeLabel : ''}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

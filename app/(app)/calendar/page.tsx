import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function Calendar() {
  await ensureSchemaOnce()
  const sql = getSql()
  const tasks = await sql<{ title: string; due_at: string }[]>`select title, due_at from tasks where due_at is not null and status in ('Open','In Progress') order by due_at asc limit 100`
  const cases = await sql<{ citation: string | null; official_no: string | null; next_action: string | null; next_action_at: string }[]>`select citation, official_no, next_action, next_action_at from cases where next_action_at is not null order by next_action_at asc limit 100`
  const items = [
    ...tasks.map((t) => ({ when: t.due_at, label: 'Task: ' + t.title })),
    ...cases.map((k) => ({ when: k.next_action_at, label: 'Case ' + (k.citation || k.official_no || '') + ': ' + (k.next_action || 'next action') })),
  ].sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime())
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Calendar / Upcoming</h1>
      <p className="text-sm text-slate-500">Upcoming task due dates and case actions.</p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {items.length === 0 && <div className="p-12 text-center text-sm text-slate-500">Nothing scheduled.</div>}
        {items.map((it, i) => (<div key={i} className="flex items-center gap-4 border-b border-slate-50 px-5 py-3"><span className="w-40 shrink-0 text-sm font-medium text-slate-700">{new Date(it.when).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</span><span className="text-sm text-slate-600">{it.label}</span></div>))}
      </div>
    </div>
  )
}

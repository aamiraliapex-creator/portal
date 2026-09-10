import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import TaskActions from './TaskActions'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type T = { id: string; title: string; case_ref: string | null; assignee: string | null; due_at: string | null; priority: string; status: string }

export default async function Tasks({ searchParams }: { searchParams: { filter?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const filter = searchParams.filter || 'all'
  const rows = await sql<T[]>`select id, title, case_ref, assignee, due_at, priority, status from tasks order by created_at desc limit 200`
  const now = Date.now()
  const isOverdue = (t: T) => (t.status === 'Open' || t.status === 'In Progress') && t.due_at != null && new Date(t.due_at).getTime() < now
  const shown = rows.filter((t) => filter === 'all' ? true : filter === 'open' ? (t.status === 'Open' || t.status === 'In Progress') : filter === 'overdue' ? isOverdue(t) : filter === 'completed' ? t.status === 'Completed' : true)
  const chip = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm ${active ? 'bg-ink-950 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`
  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-semibold text-slate-900">Tasks</h1><p className="text-sm text-slate-500">Overdue items stay flagged until completed or cancelled.</p></div>
        <Link href="/tasks/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ New task</Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {['all','open','overdue','completed'].map((f) => <Link key={f} href={`/tasks?filter=${f}`} className={chip(filter===f)}>{f[0].toUpperCase()+f.slice(1)}</Link>)}
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Task</th><th className="px-4 py-3">Case</th><th className="px-4 py-3">Assignee</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No tasks in this view.</td></tr>}
            {shown.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className={'px-4 py-3 ' + (t.status==='Completed'||t.status==='Canceled' ? 'text-slate-400 line-through' : 'font-medium text-slate-800')}>{t.title}</td>
                <td className="px-4 py-3 text-slate-600">{t.case_ref || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{t.assignee || '—'}</td>
                <td className={'px-4 py-3 ' + (isOverdue(t) ? 'font-medium text-brand-600' : 'text-slate-600')}>{t.due_at ? new Date(t.due_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}{isOverdue(t) ? ' (overdue)' : ''}</td>
                <td className="px-4 py-3 text-slate-600">{t.priority}</td>
                <td className="px-4 py-3 text-slate-600">{t.status}</td>
                <td className="px-4 py-3"><TaskActions id={t.id} status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

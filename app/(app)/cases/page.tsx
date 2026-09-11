import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Row = {
  id: string; citation: string | null; official_no: string | null; court: string | null; state: string | null;
  status: string; cdl: string; cmv: string; next_action: string | null; next_action_at: string | null;
  first_name: string; last_name: string; customer_id: string; agent_name: string | null;
}
const badge = (s: string) => {
  const m: Record<string, string> = { 'New': 'bg-slate-100 text-slate-600', 'Action Required': 'bg-amber-50 text-amber-700', 'Motion Prep': 'bg-amber-50 text-amber-700', 'Hearing Scheduled': 'bg-sky-50 text-sky-700', 'Waiting for Court': 'bg-indigo-50 text-indigo-700', 'Resolved': 'bg-emerald-50 text-emerald-700', 'Dismissed': 'bg-emerald-50 text-emerald-700' }
  return m[s] || 'bg-slate-100 text-slate-600'
}
const dotColor = (s: string) => (s.includes('Hearing') ? 'text-sky-600' : s.includes('Resolved') || s.includes('Dismissed') ? 'text-emerald-600' : 'text-amber-600')

export default async function Cases({ searchParams }: { searchParams: { q?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const q = (searchParams.q || '').trim()
  const rows = await sql<Row[]>`
    select k.id, k.citation, k.official_no, k.court, k.state, k.status, k.cdl, k.cmv, k.next_action, k.next_action_at,
           c.first_name, c.last_name, k.customer_id, u.name as agent_name
    from cases k join customers c on c.id = k.customer_id left join users u on u.id = k.agent_id
    where (${q} = '' or (coalesce(k.citation,'')||' '||coalesce(k.official_no,'')||' '||coalesce(k.court,'')||' '||c.first_name||' '||c.last_name) ilike ${'%' + q + '%'})
    order by k.created_at desc limit 200`
  const sub = (k: Row) => [k.state, k.cdl === 'Yes' ? 'CDL' : null, k.cmv === 'Yes' ? 'CMV' : null].filter(Boolean).join(' · ')
  const naText = (k: Row) => {
    if (!k.next_action) return '— none set —'
    let rel = ''
    if (k.next_action_at) { const days = Math.round((new Date(k.next_action_at).getTime() - Date.now()) / 86400000); rel = days < 0 ? ' · overdue' : days === 0 ? ' · today' : ' · in ' + days + 'd' }
    return k.next_action + rel
  }
  const naOverdue = (k: Row) => k.next_action_at != null && new Date(k.next_action_at).getTime() < Date.now()
  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-900">Cases</h1><p className="text-sm text-slate-500">Every citation is its own case. No active case is ever forgotten.</p></div>
        <Link href="/cases/new" className="btn btn-red">+ New case</Link>
      </div>
      <div className="card mt-4 p-3">
        <form method="get" action="/cases"><input name="q" defaultValue={q} placeholder="Search citation, court #…" className="inp max-w-md" /></form>
      </div>
      <div className="mt-3 card overflow-x-auto">
        <table className="min-w-full">
          <thead><tr><th>Citation</th><th>Customer</th><th>Court</th><th>Status</th><th>Next action</th><th>Agent</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-slate-500">No cases yet.</td></tr>}
            {rows.map((k) => (
              <tr key={k.id} className="rowlink">
                <td><Link href={`/customers/${k.customer_id}`} className="font-semibold text-slate-800">{k.citation || k.official_no || '—'}</Link><div className="text-xs text-slate-500">{sub(k) || '—'}</div></td>
                <td className="text-slate-700">{k.first_name} {k.last_name}</td>
                <td className="text-slate-600">{k.court || '—'}</td>
                <td><span className={'badge ' + badge(k.status)}><span className={'dot ' + dotColor(k.status)} />{k.status}</span></td>
                <td className={naOverdue(k) ? 'text-brand-600 font-medium' : 'text-slate-600'}>{naText(k)}</td>
                <td className="text-slate-700">{k.agent_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

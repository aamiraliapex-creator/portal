import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function Audit() {
  await ensureSchemaOnce()
  const sql = getSql()
  const rows = await sql<{ when: string; label: string }[]>`
    (select created_at as when, 'Customer added: ' || first_name || ' ' || last_name as label from customers order by created_at desc limit 25)
    union all (select created_at, 'Case added: ' || coalesce(citation, official_no, 'case') from cases order by created_at desc limit 25)
    union all (select created_at, 'Payment: ' || kind || ' $' || amount from payments order by created_at desc limit 25)
    union all (select created_at, 'User added: ' || name from users order by created_at desc limit 25)
    order by when desc limit 60`
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Activity Log</h1>
      <p className="text-sm text-slate-500">Recent activity across the portal.</p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {rows.length === 0 && <div className="p-12 text-center text-sm text-slate-500">No activity yet.</div>}
        {rows.map((r, i) => (<div key={i} className="flex items-center gap-4 border-b border-slate-50 px-5 py-3"><span className="w-44 shrink-0 text-xs text-slate-500">{new Date(r.when).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</span><span className="text-sm text-slate-700">{r.label}</span></div>))}
      </div>
    </div>
  )
}

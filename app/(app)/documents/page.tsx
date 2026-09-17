import { getViewerScope } from '@/lib/ownership'
import NotAvailable from '../NotAvailable'
import { getSql } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function Documents() {
  const scope = await getViewerScope()
  if (!scope) return <NotAvailable />
  const scoped = scope.scoped
  const viewerId = scope.viewerId
  const sql = getSql()
  const rows = await sql<{ id: string; category: string; file_name: string; created_at: string }[]>`
    select d.id, d.category, d.file_name, d.created_at from documents d
     where ${scoped} = false
        or exists (select 1 from customers c where c.id = d.customer_id and c.agent_id = ${viewerId})
        or exists (select 1 from cases k where k.id = d.case_id and k.agent_id = ${viewerId})
     order by d.created_at desc limit 100`
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Documents</h1>
      <p className="text-sm text-slate-500">Driver licenses, citations and case files.</p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {rows.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No documents yet. File upload uses Vercel Blob storage — I can enable it next so you can attach license &amp; citation images per customer/case.</div>}
        {rows.map((d) => (<div key={d.id} className="flex items-center gap-4 border-b border-slate-50 px-5 py-3"><span className="text-sm font-medium text-slate-700">{d.file_name}</span><span className="text-xs text-slate-500">{d.category}</span></div>))}
      </div>
    </div>
  )
}

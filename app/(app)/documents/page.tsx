import { getViewerScope, documentScopedFor } from '@/lib/ownership'
import { hasPermission } from '@/lib/authz'
import ExpiryEditor from './ExpiryEditor'
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
  const rows = await sql<{ id: string; category: string; file_name: string; created_at: string; expires_on: string | null }[]>`
    select d.id, d.category, d.file_name, d.created_at, d.expires_on from documents d
     where ${documentScopedFor(scope.user.role)} = false
        or exists (select 1 from customers c where c.id = d.customer_id and c.agent_id = ${viewerId})
        or exists (select 1 from cases k where k.id = d.case_id and k.agent_id = ${viewerId})
     order by d.created_at desc limit 100`
  const canEdit = hasPermission(scope.user.role, 'document.update')

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Documents</h1>
      <p className="text-sm text-slate-500">Driver licenses, citations and case files.</p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {rows.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No documents yet. File upload uses Vercel Blob storage — I can enable it next so you can attach license &amp; citation images per customer/case.</div>}
        {rows.map((d) => {
          const expires = d.expires_on ? new Date(d.expires_on) : null
          const days = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-4 border-b border-slate-50 px-5 py-3">
              <span className="text-sm font-medium text-slate-700">{d.file_name}</span>
              <span className="text-xs text-slate-500">{d.category}</span>
              <span className="text-xs text-slate-600">
                Expires: {expires ? expires.toLocaleDateString('en-US') : '—'}
                {days !== null && days <= 30 && (
                  <span className={'ml-2 font-semibold ' + (days < 0 ? 'text-brand-700' : 'text-amber-700')}>
                    {days < 0 ? 'EXPIRED' : `in ${days} days`}
                  </span>
                )}
              </span>
              {canEdit && <div className="ml-auto"><ExpiryEditor id={d.id} value={d.expires_on} /></div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

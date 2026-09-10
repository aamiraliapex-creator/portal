import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function Documents() {
  await ensureSchemaOnce()
  const sql = getSql()
  const rows = await sql<{ id: string; category: string; file_name: string; created_at: string }[]>`select id, category, file_name, created_at from documents order by created_at desc limit 100`
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

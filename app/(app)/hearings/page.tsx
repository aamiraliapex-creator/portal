import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function Hearings() {
  await ensureSchemaOnce()
  const sql = getSql()
  const rows = await sql<{ id: string; citation: string | null; official_no: string | null; court: string | null; status: string; next_action: string | null; next_action_at: string | null; customer_id: string; first_name: string; last_name: string }[]>`
    select k.id, k.citation, k.official_no, k.court, k.status, k.next_action, k.next_action_at, k.customer_id, c.first_name, c.last_name
    from cases k join customers c on c.id=k.customer_id
    where k.status in ('Hearing Scheduled','Waiting for Court') or k.next_action_at is not null
    order by k.next_action_at asc nulls last limit 200`
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Hearings &amp; Deadlines</h1>
      <p className="text-sm text-slate-500">Cases with a scheduled hearing or upcoming next action.</p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Case</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Court</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Next action</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No scheduled hearings.</td></tr>}
            {rows.map((k) => (<tr key={k.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-medium text-slate-800">{k.citation || k.official_no || '—'}</td><td className="px-4 py-3"><Link className="text-brand-600 hover:underline" href={`/customers/${k.customer_id}`}>{k.first_name} {k.last_name}</Link></td><td className="px-4 py-3 text-slate-600">{k.court || '—'}</td><td className="px-4 py-3 text-slate-600">{k.status}</td><td className="px-4 py-3 text-slate-600">{k.next_action || '—'}{k.next_action_at ? ' · ' + new Date(k.next_action_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { getSql } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Row = {
  id: string; first_name: string; last_name: string; plan: string | null;
  state: string | null; sub_status: string; agent_name: string | null;
}

export default async function Customers() {
  const sql = getSql()
  const customers = await sql<Row[]>`
    select c.id, c.first_name, c.last_name, c.plan, c.state, c.sub_status, u.name as agent_name
    from customers c left join users u on u.id = c.agent_id
    order by c.created_at desc limit 50`
  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-semibold text-slate-900">Customers</h1><p className="text-sm text-slate-500">One master profile per driver.</p></div>
        <Link href="/customers/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ Add customer</Link>
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Agent</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.length === 0 && (<tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No customers yet.</td></tr>)}
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800"><Link className="text-brand-600 hover:underline" href={`/customers/${c.id}`}>{c.first_name} {c.last_name}</Link></td>
                <td className="px-4 py-3 text-slate-600">{c.plan || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.agent_name || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.state || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.sub_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

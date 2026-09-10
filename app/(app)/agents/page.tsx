import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()

type Row = { id: string; name: string; customers: string; active: string; cancelled: string; cases: string; collected: string }

export default async function Agents() {
  await ensureSchemaOnce()
  const sql = getSql()
  const rows = await sql<Row[]>`
    select u.id, u.name,
      coalesce((select count(*) from customers c where c.agent_id = u.id),0) as customers,
      coalesce((select count(*) from customers c where c.agent_id = u.id and c.sub_status='Active'),0) as active,
      coalesce((select count(*) from customers c where c.agent_id = u.id and c.sub_status='Cancelled'),0) as cancelled,
      coalesce((select count(*) from cases k where k.agent_id = u.id),0) as cases,
      coalesce((select sum(p.amount) from payments p join customers c on c.id=p.customer_id where c.agent_id = u.id and p.status='Paid'),0) as collected
    from users u where u.status='ACTIVE' order by customers desc`
  const top = rows[0]
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Agents / Team</h1>
      <p className="text-sm text-slate-500">Who signs up the most customers and collects the most.</p>
      {top && Number(top.customers) > 0 && <p className="mt-2 text-xs text-slate-500">Top signups: <b className="text-slate-700">{top.name}</b> ({top.customers} customers)</p>}
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Customers</th><th className="px-4 py-3">Active</th><th className="px-4 py-3">Cancelled</th><th className="px-4 py-3">Cases</th><th className="px-4 py-3">Collected</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No agents yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-3 font-semibold text-slate-700">{r.customers}</td>
                <td className="px-4 py-3 text-emerald-600">{r.active}</td>
                <td className="px-4 py-3 text-rose-600">{r.cancelled}</td>
                <td className="px-4 py-3 text-slate-600">{r.cases}</td>
                <td className="px-4 py-3 text-emerald-600">{money(Number(r.collected))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

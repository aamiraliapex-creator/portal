import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()

function Bars({ pairs }: { pairs: [string, number][] }) {
  const max = Math.max(1, ...pairs.map((p) => p[1]))
  return (
    <div className="space-y-2">
      {pairs.length === 0 && <p className="text-sm text-slate-500">No data yet.</p>}
      {pairs.map(([label, n]) => (
        <div key={label} className="flex items-center gap-3 text-sm">
          <span className="w-44 truncate text-slate-600">{label}</span>
          <div className="h-3 flex-1 rounded bg-slate-100"><div className="h-3 rounded bg-brand-600" style={{ width: Math.round((n / max) * 100) + '%' }} /></div>
          <span className="w-14 text-right text-slate-700">{n}</span>
        </div>
      ))}
    </div>
  )
}

export default async function Reports() {
  await ensureSchemaOnce()
  const sql = getSql()
  const byStatus = await sql<{ status: string; n: number }[]>`select status, count(*)::int n from cases group by status order by n desc`
  const byMethod = await sql<{ method: string; total: string }[]>`select method, sum(amount) total from payments where status='Paid' group by method order by total desc`
  const newCust = await sql<{ m: string; n: number }[]>`select to_char(date_trunc('month', joined_at),'Mon YYYY') m, count(*)::int n from customers group by 1 order by min(joined_at)`
  const byAgent = await sql<{ name: string; n: number }[]>`select u.name, count(c.*)::int n from users u left join customers c on c.agent_id=u.id where u.status='ACTIVE' group by u.name order by n desc`
  const [collected] = await sql<{ t: string }[]>`select coalesce(sum(amount),0) t from payments where status='Paid'`
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
      <p className="text-sm text-slate-500">Live from your database.</p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 text-sm font-semibold text-slate-700">Cases by status</h2><Bars pairs={byStatus.map((r)=>[r.status, r.n])} /></div>
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 text-sm font-semibold text-slate-700">Customers by agent</h2><Bars pairs={byAgent.map((r)=>[r.name, r.n])} /></div>
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 text-sm font-semibold text-slate-700">New customers by month</h2><Bars pairs={newCust.map((r)=>[r.m, r.n])} /></div>
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 text-sm font-semibold text-slate-700">Payments by method</h2>
          <div className="space-y-2 text-sm">{byMethod.length===0 && <p className="text-slate-500">No payments yet.</p>}{byMethod.map((r)=>(<div key={r.method} className="flex justify-between"><span className="text-slate-600">{r.method}</span><span className="font-medium text-slate-800">{money(Number(r.total))}</span></div>))}</div>
          <p className="mt-3 border-t border-slate-100 pt-2 text-sm font-semibold text-slate-700">Total collected: {money(Number(collected.t))}</p>
        </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()

export default async function Dashboard() {
  await ensureSchemaOnce()
  const sql = getSql()
  const [c] = await sql<{ total: number; active: number; cancelled: number }[]>`select count(*)::int total, count(*) filter (where sub_status='Active')::int active, count(*) filter (where sub_status='Cancelled')::int cancelled from customers`
  const [k] = await sql<{ open: number }[]>`select count(*) filter (where status not in ('Resolved','Dismissed'))::int open from cases`
  const [t] = await sql<{ overdue: number }[]>`select count(*) filter (where status in ('Open','In Progress') and due_at < now())::int overdue from tasks`
  const [p] = await sql<{ collected: string; outstanding: string }[]>`select coalesce(sum(amount) filter (where status='Paid'),0) collected, coalesce(sum(amount) filter (where status in ('Pending','Overdue')),0) outstanding from payments`
  const methods = await sql<{ method: string; total: string }[]>`select method, sum(amount) total from payments where status='Paid' group by method order by total desc`
  const topAgents = await sql<{ name: string; n: number }[]>`select u.name, count(c.*)::int n from users u left join customers c on c.agent_id=u.id where u.status='ACTIVE' group by u.name order by n desc limit 5`
  const recent = await sql<{ id: string; first_name: string; last_name: string; plan: string | null; sub_status: string; created_at: string }[]>`select id, first_name, last_name, plan, sub_status, created_at from customers order by created_at desc limit 6`
  const kpis: [string, string | number, string][] = [
    ['Total Customers', c.total, 'text-slate-900'], ['Active Members', c.active, 'text-emerald-600'],
    ['Open Cases', k.open, 'text-brand-600'], ['Overdue Tasks', t.overdue, 'text-brand-600'],
    ['Collected', money(Number(p.collected)), 'text-emerald-600'], ['Outstanding', money(Number(p.outstanding)), 'text-brand-600'],
  ]
  const maxM = Math.max(1, ...methods.map((m) => Number(m.total)))
  return (
    <div>
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white">
        <span>📢</span><p className="flex-1"><b>Welcome back.</b> Portal shows California &amp; Pakistan time in the top bar. Data below is live from your database.</p>
      </div>
      <h1 className="text-xl font-semibold text-slate-900">Operations Dashboard</h1>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([label, val, color]) => (
          <div key={label} className="card p-4"><p className="text-xs text-slate-500">{label}</p><p className={'mt-1 text-2xl font-extrabold ' + color}>{val}</p></div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700">Payments by method</h2>
          <div className="mt-3 space-y-2 text-sm">
            {methods.length === 0 && <p className="text-slate-500">No payments recorded yet.</p>}
            {methods.map((m) => (
              <div key={m.method} className="flex items-center gap-3">
                <span className="w-16 text-slate-600">{m.method}</span>
                <div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: Math.round((Number(m.total) / maxM) * 100) + '%' }} /></div>
                <span className="w-20 text-right text-slate-500">{money(Number(m.total))}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Top Sales Agents</h2></div>
          <div className="divide-y divide-slate-50 p-2">
            {topAgents.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">No agents yet.</p>}
            {topAgents.map((a, i) => (
              <div key={a.name} className="flex items-center gap-3 px-3 py-2">
                <span className={'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ' + (i === 0 ? 'bg-gold-500 text-ink-950' : i === 1 ? 'bg-slate-300 text-white' : 'bg-brand-700 text-white')}>{i + 1}</span>
                <div className="flex-1"><p className="text-sm font-medium text-slate-800">{a.name}</p><p className="text-xs text-slate-500">{a.n} customers</p></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-5">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Recent members</h2><Link href="/customers" className="text-xs font-semibold text-brand-600">View all</Link></div>
        <div className="overflow-x-auto">
          <table className="min-w-full"><thead><tr><th>Member</th><th>Plan</th><th>Subscription</th><th>Joined</th></tr></thead>
            <tbody>
              {recent.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-slate-500">No customers yet.</td></tr>}
              {recent.map((r) => (
                <tr key={r.id} className="rowlink"><td><Link className="font-medium text-brand-600" href={`/customers/${r.id}`}>{r.first_name} {r.last_name}</Link></td><td>{r.plan || '—'}</td><td>{r.sub_status}</td><td>{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

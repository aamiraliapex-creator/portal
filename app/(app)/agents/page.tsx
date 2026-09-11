import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import AssignPanel from './AssignPanel'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()

type Row = { id: string; name: string; customers: number; active: number; cancelled: number; cases: number; collected: string }

export default async function Agents({ searchParams }: { searchParams: { from?: string; to?: string; agent?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const from = searchParams.from || null
  const to = searchParams.to || null
  const range = sql`(${from}::date is null or coalesce(cu.joined_at,cu.created_at) >= ${from}::date) and (${to}::date is null or coalesce(cu.joined_at,cu.created_at) < (${to}::date + 1))`

  const rows = await sql<Row[]>`
    select u.id, u.name,
      (select count(*) from customers cu where cu.agent_id=u.id and ${range})::int customers,
      (select count(*) from customers cu where cu.agent_id=u.id and cu.sub_status='Active' and ${range})::int active,
      (select count(*) from customers cu where cu.agent_id=u.id and cu.sub_status='Cancelled' and ${range})::int cancelled,
      (select count(*) from cases k where k.agent_id=u.id)::int cases,
      (select coalesce(sum(p.amount),0) from payments p join customers cu on cu.id=p.customer_id where cu.agent_id=u.id and p.status='Paid') collected
    from users u where u.status='ACTIVE' order by customers desc`
  const top = rows[0]

  const custList = await sql<{ id: string; name: string }[]>`select id, (first_name||' '||last_name) name from customers order by created_at desc limit 500`
  const agentList = await sql<{ id: string; name: string }[]>`select id, name from users where status='ACTIVE' order by name`

  // drill-down
  let drill: React.ReactNode = null
  if (searchParams.agent) {
    const aId = searchParams.agent
    const a = rows.find((r) => r.id === aId)
    const custs = await sql<{ id: string; first_name: string; last_name: string; legacy_member_id: string | null; plan: string | null; sub_status: string; joined: string }[]>`
      select id, first_name, last_name, legacy_member_id, plan, sub_status, coalesce(joined_at,created_at) joined from customers where agent_id=${aId} order by coalesce(joined_at,created_at) desc`
    if (a) drill = (
      <div className="card mt-4 p-5">
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-slate-900">{a.name} — performance</h2><Link href="/agents" className="chip">Close</Link></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[['Customers', a.customers, 'text-slate-900'], ['Active', a.active, 'text-emerald-600'], ['Cancelled', a.cancelled, 'text-rose-600'], ['Cases', a.cases, 'text-slate-900'], ['Collected', money(Number(a.collected)), 'text-emerald-600']].map(([l, v, c]) => <div key={l as string} className="rounded-lg bg-slate-50 p-3 text-center"><p className={'text-lg font-bold ' + c}>{v as any}</p><p className="text-[11px] text-slate-500">{l as string}</p></div>)}
        </div>
        <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-700">Customers signed up by {a.name}</h3>
        <div className="overflow-x-auto"><table className="min-w-full"><thead><tr><th>Customer</th><th>Joined</th><th>Plan</th><th>Subscription</th></tr></thead><tbody>
          {custs.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">No customers.</td></tr>}
          {custs.map((c) => <tr key={c.id} className="rowlink"><td><Link className="font-medium text-brand-600" href={`/customers/${c.id}`}>{c.first_name} {c.last_name}</Link><div className="text-slate-400">{c.legacy_member_id || ''}</div></td><td>{new Date(c.joined).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td><td>{c.plan || '—'}</td><td>{c.sub_status}</td></tr>)}
        </tbody></table></div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900">Agents / Team</h1>
      <p className="text-sm text-slate-500">See who signs up the most customers. Click an agent for their breakdown.</p>
      <div className="card mt-4 p-3">
        <form method="get" action="/agents" className="flex flex-wrap items-end gap-3">
          <div><span className="lbl">Joined from</span><input type="date" name="from" defaultValue={from || ''} className="inp" /></div>
          <div><span className="lbl">Joined to</span><input type="date" name="to" defaultValue={to || ''} className="inp" /></div>
          <button className="btn btn-red">Apply</button><Link href="/agents" className="chip">Clear</Link>
          {top && top.customers > 0 && <span className="ml-auto text-xs text-slate-500">Top signups: {top.name} ({top.customers} customers)</span>}
        </form>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Agent performance</h2></div>
          <div className="overflow-x-auto"><table className="min-w-full"><thead><tr><th>Agent</th><th>Customers</th><th>Active</th><th>Cancelled</th><th>Cases</th><th>Collected</th></tr></thead><tbody>
            {rows.map((r) => <tr key={r.id} className="rowlink"><td><Link className="font-semibold text-brand-600" href={`/agents?agent=${r.id}`}>{r.name}</Link></td><td className="font-semibold">{r.customers}</td><td className="text-emerald-600">{r.active}</td><td className="text-rose-600">{r.cancelled}</td><td>{r.cases}</td><td className="text-emerald-600">{money(Number(r.collected))}</td></tr>)}
          </tbody></table></div>
        </div>
        <AssignPanel customers={custList} agents={agentList} />
      </div>
      {drill}
    </div>
  )
}

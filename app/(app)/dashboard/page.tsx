import { getSql } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const sql = getSql()
  const [tot] = await sql`select count(*)::int as n from customers`
  const [act] = await sql`select count(*)::int as n from customers where sub_status = 'Active'`
  const [cas] = await sql`select count(*)::int as n from cases`
  const [tsk] = await sql`select count(*)::int as n from tasks where status in ('Open','In Progress')`
  const cards: [string, number][] = [
    ['Total Customers', tot.n], ['Active Members', act.n],
    ['Total Cases', cas.n], ['Open Tasks', tsk.n],
  ]
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Operations Dashboard</h1>
      <p className="text-sm text-slate-500">Live figures from your database.</p>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

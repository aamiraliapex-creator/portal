import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import ExportButtons from './ExportButtons'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()

const REPORTS: [string, string][] = [
  ['status', 'Cases by Status'], ['agent', 'Cases by Agent'], ['custagent', 'Customers by Agent'],
  ['method', 'Payments by Method'], ['outstanding', 'Outstanding Invoices'], ['newcust', 'New Customers by Month'], ['hearings', 'Upcoming Hearings'],
]
function Bars({ pairs }: { pairs: [string, number][] }) {
  const max = Math.max(1, ...pairs.map((p) => p[1]))
  return (<div className="space-y-3">{pairs.length === 0 && <p className="text-sm text-slate-500">No data.</p>}{pairs.map(([l, n]) => (
    <div key={l} className="flex items-center gap-4 text-sm"><span className="w-48 truncate text-slate-700">{l}</span><div className="h-3 flex-1 rounded bg-slate-100"><div className="h-3 rounded bg-brand-600" style={{ width: Math.round((n / max) * 100) + '%' }} /></div><span className="w-10 text-right font-medium">{n}</span></div>))}</div>)
}

export default async function Reports({ searchParams }: { searchParams: { r?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const r = REPORTS.find(([k]) => k === searchParams.r)?.[0] || 'status'
  const title = REPORTS.find(([k]) => k === r)![1]

  let content: React.ReactNode = null
  if (r === 'status') { const d = await sql<{ status: string; n: number }[]>`select status, count(*)::int n from cases group by status order by n desc`; content = <Bars pairs={d.map((x) => [x.status, x.n])} /> }
  else if (r === 'agent') { const d = await sql<{ name: string; n: number }[]>`select coalesce(u.name,'Unassigned') name, count(k.*)::int n from cases k left join users u on u.id=k.agent_id group by 1 order by n desc`; content = <Bars pairs={d.map((x) => [x.name, x.n])} /> }
  else if (r === 'custagent') { const d = await sql<{ name: string; n: number }[]>`select coalesce(u.name,'Unassigned') name, count(c.*)::int n from customers c left join users u on u.id=c.agent_id group by 1 order by n desc`; content = <Bars pairs={d.map((x) => [x.name, x.n])} /> }
  else if (r === 'method') { const d = await sql<{ method: string; total: string }[]>`select method, sum(amount) total from payments where status='Paid' group by method order by total desc`; const tot = d.reduce((a, x) => a + Number(x.total), 0); content = <div><div className="space-y-2 text-sm">{d.length === 0 && <p className="text-slate-500">No payments.</p>}{d.map((x) => <div key={x.method} className="flex justify-between"><span className="text-slate-600">{x.method}</span><span className="font-medium">{money(Number(x.total))}</span></div>)}</div><p className="mt-3 border-t border-slate-100 pt-2 font-semibold">Total collected: {money(tot)}</p></div> }
  else if (r === 'outstanding') { const d = await sql<{ invoice: string | null; first_name: string; last_name: string; amount: string; status: string }[]>`select p.invoice, c.first_name, c.last_name, p.amount, p.status from payments p join customers c on c.id=p.customer_id where p.status in ('Pending','Overdue') order by p.paid_at desc`; content = <table className="min-w-full"><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>{d.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">None.</td></tr>}{d.map((x, i) => <tr key={i}><td>{x.invoice || '—'}</td><td>{x.first_name} {x.last_name}</td><td className="text-brand-600 font-medium">{money(Number(x.amount))}</td><td>{x.status}</td></tr>)}</tbody></table> }
  else if (r === 'newcust') { const d = await sql<{ m: string; n: number }[]>`select to_char(date_trunc('month', coalesce(joined_at,created_at)),'Mon YYYY') m, count(*)::int n from customers group by 1 order by min(coalesce(joined_at,created_at))`; content = <Bars pairs={d.map((x) => [x.m, x.n])} /> }
  else { const d = await sql<{ citation: string | null; official_no: string | null; first_name: string; last_name: string; court: string | null; status: string }[]>`select k.citation, k.official_no, c.first_name, c.last_name, k.court, k.status from cases k join customers c on c.id=k.customer_id where k.status in ('Hearing Scheduled','Waiting for Court') or k.next_action_at is not null order by k.next_action_at asc nulls last`; content = <table className="min-w-full"><thead><tr><th>Case</th><th>Customer</th><th>Court</th><th>Status</th></tr></thead><tbody>{d.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">None.</td></tr>}{d.map((x, i) => <tr key={i}><td>{x.citation || x.official_no || '—'}</td><td>{x.first_name} {x.last_name}</td><td>{x.court || '—'}</td><td>{x.status}</td></tr>)}</tbody></table> }

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900">Reports</h1>
      <p className="text-sm text-slate-500">Click a report to view it on screen. Export respects your permissions.</p>
      <div className="card mt-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><span className="lbl">From</span><input type="date" className="inp" /></div>
          <div><span className="lbl">To</span><input type="date" className="inp" /></div>
          <button className="btn btn-red">Apply</button><button className="chip">Clear</button>
          <span className="ml-auto text-xs text-slate-400">Date filter applies to payments &amp; signup reports</span>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="card p-2">
          {REPORTS.map(([k, label]) => (
            <Link key={k} href={`/reports?r=${k}`} className={'block rounded-lg px-3 py-2 text-sm font-medium ' + (r === k ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50')}>{label}</Link>
          ))}
        </div>
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">{title}</h2><ExportButtons r={r} /></div>
          {content}
        </div>
      </div>
    </div>
  )
}

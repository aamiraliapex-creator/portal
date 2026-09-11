import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

export default async function Payments({ searchParams }: { searchParams: { tab?: string; from?: string; to?: string; status?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const tab = ['payments', 'invoices', 'subscriptions'].includes(searchParams.tab || '') ? searchParams.tab! : 'bycustomer'
  const from = searchParams.from || null
  const to = searchParams.to || null
  const status = searchParams.status || 'all'
  const inRange = sql`(${from}::date is null or p.paid_at >= ${from}::date) and (${to}::date is null or p.paid_at < (${to}::date + 1))`

  const [tot] = await sql<{ paid: string; unpaid: string; cpaid: number; cunpaid: number }[]>`
    select
      coalesce(sum(p.amount) filter (where p.status='Paid'),0) paid,
      coalesce(sum(p.amount) filter (where p.status in ('Pending','Overdue')),0) unpaid,
      (select count(distinct c.id) from customers c where exists (select 1 from payments p where p.customer_id=c.id and p.status='Paid' and ${inRange}) and not exists (select 1 from payments p where p.customer_id=c.id and p.status in ('Pending','Overdue')))::int cpaid,
      (select count(distinct c.id) from customers c where exists (select 1 from payments p where p.customer_id=c.id and p.status in ('Pending','Overdue') and ${inRange}))::int cunpaid
    from payments p where ${inRange}`

  const cards: [string, string, string][] = [
    ['Total Paid', money(Number(tot.paid)), 'text-emerald-600'], ['Total Unpaid', money(Number(tot.unpaid)), 'text-brand-600'],
    ['Customers Paid', String(tot.cpaid), 'text-slate-900'], ['Customers Unpaid', String(tot.cunpaid), 'text-slate-900'],
  ]
  const tabDef: [string, string][] = [['bycustomer', 'By customer'], ['payments', 'Payments'], ['invoices', 'Invoices'], ['subscriptions', 'Subscriptions']]
  const qs = (over: Record<string, string>) => { const pr = new URLSearchParams(); if (tab) pr.set('tab', tab); if (from) pr.set('from', from); if (to) pr.set('to', to); if (status !== 'all') pr.set('status', status); Object.entries(over).forEach(([k, v]) => v ? pr.set(k, v) : pr.delete(k)); return '/payments?' + pr.toString() }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-900">Payments &amp; Invoices</h1><p className="text-sm text-slate-500">Live from every customer. See who paid, who hasn&apos;t, and totals — filter by date.</p></div>
        <Link href="/payments/new" className="btn btn-red">+ Record payment</Link>
      </div>

      <div className="card mt-4 p-3">
        <form method="get" action="/payments" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value={tab} />
          <div><span className="lbl">From</span><input type="date" name="from" defaultValue={from || ''} className="inp" /></div>
          <div><span className="lbl">To</span><input type="date" name="to" defaultValue={to || ''} className="inp" /></div>
          <Link href={qs({ status: '' })} className={'chip ' + (status === 'all' ? 'active' : '')}>All</Link>
          <Link href={qs({ status: 'paid' })} className={'chip ' + (status === 'paid' ? 'active' : '')}>Paid</Link>
          <Link href={qs({ status: 'unpaid' })} className={'chip ' + (status === 'unpaid' ? 'active' : '')}>Unpaid</Link>
          <button className="btn btn-red">Apply</button>
          <Link href="/payments" className="chip">Clear</Link>
        </form>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map(([l, v, c]) => <div key={l} className="card p-4"><p className="text-xs text-slate-500">{l}</p><p className={'mt-1 text-2xl font-extrabold ' + c}>{v}</p></div>)}
      </div>

      <div className="mt-5 flex gap-5 border-b border-slate-200">
        {tabDef.map(([kk, label]) => <Link key={kk} href={qs({ tab: kk })} className={'pb-2 text-sm font-medium ' + (tab === kk ? 'border-b-2 border-brand-600 text-brand-600' : 'text-slate-500')}>{label}</Link>)}
      </div>
      <div className="mt-4 card overflow-x-auto">{await Panel({ tab, status, from, to, sql })}</div>
    </div>
  )
}

async function Panel({ tab, status, from, to, sql }: { tab: string; status: string; from: string | null; to: string | null; sql: ReturnType<typeof getSql> }) {
  const range = sql`(${from}::date is null or p.paid_at >= ${from}::date) and (${to}::date is null or p.paid_at < (${to}::date + 1))`
  const stFilter = sql`(${status}='all' or (${status}='paid' and p.status='Paid') or (${status}='unpaid' and p.status in ('Pending','Overdue')))`
  if (tab === 'payments') {
    const rows = await sql<{ id: string; paid_at: string; kind: string; method: string; amount: string; status: string; invoice: string | null; customer_id: string; first_name: string; last_name: string }[]>`
      select p.id,p.paid_at,p.kind,p.method,p.amount,p.status,p.invoice,p.customer_id,c.first_name,c.last_name from payments p join customers c on c.id=p.customer_id where ${range} and ${stFilter} order by p.paid_at desc limit 300`
    return (<table className="min-w-full"><thead><tr><th>Date</th><th>Customer</th><th>For</th><th>Method</th><th>Invoice</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-500">No payments match.</td></tr>}{rows.map((p) => <tr key={p.id}><td>{d(p.paid_at)}</td><td><Link className="text-brand-600" href={`/customers/${p.customer_id}`}>{p.first_name} {p.last_name}</Link></td><td>{p.kind}</td><td>{p.method}</td><td className="text-slate-500">{p.invoice || '—'}</td><td className="font-medium">{money(Number(p.amount))}</td><td>{p.status}</td></tr>)}</tbody></table>)
  }
  if (tab === 'invoices') {
    const rows = await sql<{ id: string; invoice: string | null; amount: string; status: string; customer_id: string; first_name: string; last_name: string }[]>`select p.id,p.invoice,p.amount,p.status,p.customer_id,c.first_name,c.last_name from payments p join customers c on c.id=p.customer_id where p.status in ('Pending','Overdue') and ${range} order by p.paid_at desc`
    return (<table className="min-w-full"><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-slate-500">No outstanding invoices.</td></tr>}{rows.map((p) => <tr key={p.id}><td>{p.invoice || '—'}</td><td><Link className="text-brand-600" href={`/customers/${p.customer_id}`}>{p.first_name} {p.last_name}</Link></td><td className="font-medium text-brand-600">{money(Number(p.amount))}</td><td>{p.status}</td></tr>)}</tbody></table>)
  }
  if (tab === 'subscriptions') {
    const rows = await sql<{ id: string; first_name: string; last_name: string; legacy_member_id: string | null; plan: string | null; sub_status: string; next_payment: string | null }[]>`select id, first_name, last_name, legacy_member_id, plan, sub_status, next_payment from customers order by created_at desc`
    return (<table className="min-w-full"><thead><tr><th>Customer</th><th>Plan</th><th>Subscription</th><th>Next payment</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id}><td><Link className="font-medium text-brand-600" href={`/customers/${c.id}`}>{c.first_name} {c.last_name}</Link><div className="text-slate-400">{c.legacy_member_id || ''}</div></td><td>{c.plan || '—'}</td><td>{c.sub_status}</td><td>{c.next_payment || '—'}</td></tr>)}</tbody></table>)
  }
  const rows = await sql<{ id: string; first_name: string; last_name: string; legacy_member_id: string | null; next_payment: string | null; paid: string; outstanding: string; last_paid: string | null }[]>`
    select c.id, c.first_name, c.last_name, c.legacy_member_id, c.next_payment,
      coalesce(sum(p.amount) filter (where p.status='Paid' and ${range}),0) paid,
      coalesce(sum(p.amount) filter (where p.status in ('Pending','Overdue') and ${range}),0) outstanding,
      max(p.paid_at) filter (where p.status='Paid') last_paid
    from customers c left join payments p on p.customer_id=c.id group by c.id order by paid desc`
  return (<table className="min-w-full"><thead><tr><th>Customer</th><th>Paid</th><th>Outstanding</th><th>Last payment</th><th>Next payment</th><th>Status</th></tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-slate-500">No customers yet.</td></tr>}{rows.map((r) => { const out = Number(r.outstanding); return (<tr key={r.id}><td><Link className="font-medium text-brand-600" href={`/customers/${r.id}`}>{r.first_name} {r.last_name}</Link><div className="text-slate-400">{r.legacy_member_id || ''}</div></td><td className="text-emerald-600 font-medium">{money(Number(r.paid))}</td><td className={out > 0 ? 'text-brand-600 font-medium' : 'text-slate-400'}>{money(out)}</td><td className="text-slate-500">{d(r.last_paid)}</td><td className="text-slate-500">{r.next_payment || '—'}</td><td>{out > 0 ? <span className="badge bg-rose-50 text-rose-700"><span className="dot" />Unpaid</span> : Number(r.paid) > 0 ? <span className="badge bg-emerald-50 text-emerald-700"><span className="dot" />Paid</span> : <span className="text-slate-400">—</span>}</td></tr>) })}</tbody></table>)
}

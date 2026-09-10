import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const money = (n: number) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })

type Ledger = {
  id: string; paid_at: string; kind: string; method: string; amount: string; status: string; invoice: string | null;
  first_name: string; last_name: string; customer_id: string;
}
type ByCust = { customer_id: string; first_name: string; last_name: string; paid: string; outstanding: string; last_paid: string | null }

export default async function Payments({ searchParams }: { searchParams: { tab?: string; status?: string; from?: string; to?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const tab = searchParams.tab === 'bycustomer' ? 'bycustomer' : 'ledger'
  const status = searchParams.status || 'all'
  const from = searchParams.from || null
  const to = searchParams.to || null

  const [tot] = await sql<{ collected: string; outstanding: string }[]>`
    select coalesce(sum(amount) filter (where status='Paid'),0) as collected,
           coalesce(sum(amount) filter (where status in ('Pending','Overdue')),0) as outstanding
    from payments`

  const ledger = await sql<Ledger[]>`
    select p.id, p.paid_at, p.kind, p.method, p.amount, p.status, p.invoice, p.customer_id, c.first_name, c.last_name
    from payments p join customers c on c.id = p.customer_id
    where (${status} = 'all' or (${status} = 'paid' and p.status = 'Paid') or (${status} = 'unpaid' and p.status in ('Pending','Overdue')))
      and (${from}::timestamptz is null or p.paid_at >= ${from}::timestamptz)
      and (${to}::timestamptz is null or p.paid_at <= (${to}::timestamptz + interval '1 day'))
    order by p.paid_at desc limit 200`

  const byCust = await sql<ByCust[]>`
    select c.id as customer_id, c.first_name, c.last_name,
           coalesce(sum(p.amount) filter (where p.status='Paid'),0) as paid,
           coalesce(sum(p.amount) filter (where p.status in ('Pending','Overdue')),0) as outstanding,
           max(p.paid_at) filter (where p.status='Paid') as last_paid
    from customers c left join payments p on p.customer_id = c.id
    group by c.id, c.first_name, c.last_name order by paid desc`

  const chip = (label: string, href: string, active: boolean) =>
    `inline-block rounded-lg px-3 py-1.5 text-sm ${active ? 'bg-ink-950 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`

  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-semibold text-slate-900">Payments</h1><p className="text-sm text-slate-500">Newest first. Membership &amp; case fees, with paid vs. outstanding.</p></div>
        <Link href="/payments/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ Record payment</Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Total collected</p><p className="mt-1 text-2xl font-extrabold text-emerald-600">{money(Number(tot.collected))}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Outstanding</p><p className="mt-1 text-2xl font-extrabold text-brand-600">{money(Number(tot.outstanding))}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Payments</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{ledger.length}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Customers</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{byCust.length}</p></div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href="/payments?tab=ledger" className={chip('Ledger', '', tab === 'ledger')}>Ledger</Link>
        <Link href="/payments?tab=bycustomer" className={chip('By customer', '', tab === 'bycustomer')}>By customer</Link>
        {tab === 'ledger' && (
          <span className="ml-auto flex gap-1.5">
            <Link href="/payments?tab=ledger&status=all" className={chip('All', '', status === 'all')}>All</Link>
            <Link href="/payments?tab=ledger&status=paid" className={chip('Paid', '', status === 'paid')}>Paid</Link>
            <Link href="/payments?tab=ledger&status=unpaid" className={chip('Unpaid', '', status === 'unpaid')}>Unpaid</Link>
          </span>
        )}
      </div>

      {tab === 'ledger' ? (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">For</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {ledger.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No payments match this filter.</td></tr>}
              {ledger.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="px-4 py-3"><Link className="text-brand-600 hover:underline" href={`/customers/${p.customer_id}`}>{p.first_name} {p.last_name}</Link></td>
                  <td className="px-4 py-3 text-slate-600">{p.kind}</td>
                  <td className="px-4 py-3 text-slate-600">{p.method}</td>
                  <td className="px-4 py-3 text-slate-500">{p.invoice || '—'}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{money(Number(p.amount))}</td>
                  <td className="px-4 py-3">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Total paid</th><th className="px-4 py-3">Outstanding</th><th className="px-4 py-3">Last payment</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {byCust.map((r) => (
                <tr key={r.customer_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><Link className="text-brand-600 hover:underline" href={`/customers/${r.customer_id}`}>{r.first_name} {r.last_name}</Link></td>
                  <td className="px-4 py-3 text-emerald-600 font-medium">{money(Number(r.paid))}</td>
                  <td className={'px-4 py-3 ' + (Number(r.outstanding) > 0 ? 'text-brand-600 font-medium' : 'text-slate-400')}>{money(Number(r.outstanding))}</td>
                  <td className="px-4 py-3 text-slate-500">{r.last_paid ? new Date(r.last_paid).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const money = (n: number) => '$' + Number(n || 0).toLocaleString()
const PAGE = 50

type Row = {
  id: string; legacy_member_id: string | null; first_name: string; last_name: string;
  email: string | null; phone: string | null; state: string | null; plan: string | null;
  sub_status: string; pay_channel: string | null; next_payment: string | null; cdl: string;
  license_no: string | null; dot: string; joined: string; agent_name: string | null;
  cases: number; inv_paid: number; overdue_amt: string;
}

const subBadge = (s: string) => s === 'Active' ? 'bg-emerald-50 text-emerald-700' : s === 'Cancelled' ? 'bg-rose-50 text-rose-700' : s === 'Past due' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'

export default async function Customers({ searchParams }: { searchParams: { q?: string; from?: string; to?: string; status?: string; page?: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const q = (searchParams.q || '').trim()
  const from = searchParams.from || null
  const to = searchParams.to || null
  const status = searchParams.status || 'all'
  const page = Math.max(1, parseInt(searchParams.page || '1') || 1)

  // KPIs over the date-filtered set
  const [k] = await sql<{ total: number; active: number; cancelled: number; pastdue: number; cdl: number; overdue: number }[]>`
    select count(*)::int total,
      count(*) filter (where sub_status='Active')::int active,
      count(*) filter (where sub_status='Cancelled')::int cancelled,
      count(*) filter (where sub_status='Past due')::int pastdue,
      count(*) filter (where cdl='Yes')::int cdl,
      count(*) filter (where exists (select 1 from payments p where p.customer_id=customers.id and p.status in ('Pending','Overdue')))::int overdue
    from customers
    where (${from}::date is null or coalesce(joined_at,created_at) >= ${from}::date)
      and (${to}::date is null or coalesce(joined_at,created_at) < (${to}::date + 1))`

  const where = sql`
    where (${q} = '' or (c.first_name||' '||c.last_name||' '||coalesce(c.email,'')||' '||coalesce(c.legacy_member_id,'')) ilike ${'%' + q + '%'})
      and (${from}::date is null or coalesce(c.joined_at,c.created_at) >= ${from}::date)
      and (${to}::date is null or coalesce(c.joined_at,c.created_at) < (${to}::date + 1))
      and (${status} = 'all'
           or (${status} = 'cdl' and c.cdl = 'Yes')
           or (${status} <> 'cdl' and c.sub_status = ${status}))`

  const [cnt] = await sql<{ n: number }[]>`select count(*)::int n from customers c ${where}`
  const total = cnt.n
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const cur = Math.min(page, pages)
  const rows = await sql<Row[]>`
    select c.id, c.legacy_member_id, c.first_name, c.last_name, c.email, c.phone, c.state, c.plan,
      c.sub_status, c.pay_channel, c.next_payment, c.cdl, c.license_no, c.dot,
      coalesce(c.joined_at, c.created_at) as joined, u.name as agent_name,
      (select count(*) from cases k where k.customer_id=c.id)::int cases,
      (select count(*) from payments p where p.customer_id=c.id and p.status='Paid')::int inv_paid,
      (select coalesce(sum(p.amount),0) from payments p where p.customer_id=c.id and p.status in ('Pending','Overdue')) overdue_amt
    from customers c left join users u on u.id=c.agent_id
    ${where}
    order by coalesce(c.joined_at,c.created_at) desc, c.created_at desc
    limit ${PAGE} offset ${(cur - 1) * PAGE}`

  const kpis: [string, number | string, string][] = [
    ['Total Customers', k.total, 'text-slate-900'], ['Active', k.active, 'text-emerald-600'],
    ['Cancelled', k.cancelled, 'text-rose-600'], ['Past due', k.pastdue, 'text-amber-600'],
    ['CDL Drivers', k.cdl, 'text-brand-600'], ['With overdue $', k.overdue, 'text-rose-600'],
  ]
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams(); if (q) p.set('q', q); if (from) p.set('from', from); if (to) p.set('to', to); if (status !== 'all') p.set('status', status)
    Object.entries(over).forEach(([kk, vv]) => vv ? p.set(kk, vv) : p.delete(kk)); const s = p.toString(); return '/customers' + (s ? '?' + s : '')
  }
  const chips: [string, string][] = [['all', 'All'], ['Active', 'Active'], ['Cancelled', 'Cancelled'], ['Past due', 'Past due'], ['cdl', 'CDL only']]
  const d = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-900">Customers</h1><p className="text-sm text-slate-500">Master profiles with documents, payments &amp; next payment — filter by join date.</p></div>
        <Link href="/customers/new" className="btn btn-red">+ Add customer</Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([l, v, c]) => <div key={l} className="card p-4"><p className="text-xs text-slate-500">{l}</p><p className={'mt-1 text-2xl font-extrabold ' + c}>{v}</p></div>)}
      </div>

      <div className="card mt-4 p-3">
        <form method="get" action="/customers" className="flex flex-wrap items-end gap-3">
          {status !== 'all' && <input type="hidden" name="status" value={status} />}
          <div className="min-w-[200px] flex-1"><span className="lbl">Search</span><input name="q" defaultValue={q} placeholder="Name, email, member ID…" className="inp" /></div>
          <div><span className="lbl">Joined from</span><input type="date" name="from" defaultValue={from || ''} className="inp" /></div>
          <div><span className="lbl">Joined to</span><input type="date" name="to" defaultValue={to || ''} className="inp" /></div>
          <button className="btn btn-red">Apply</button>
          <Link href="/customers" className="chip">Clear</Link>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map(([val, label]) => <Link key={val} href={qs({ status: val === 'all' ? '' : val, page: '' })} className={'chip ' + (status === val ? 'active' : '')}>{label}</Link>)}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {rows.length === 0 && <div className="card p-10 text-center text-sm text-slate-500">No customers match these filters.</div>}
        {rows.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
              <div className="lg:col-span-2">
                <div className="flex items-center gap-2">
                  <span className={'inline-block h-2 w-2 rounded-full ' + (c.sub_status === 'Active' ? 'bg-emerald-500' : c.sub_status === 'Cancelled' ? 'bg-rose-500' : 'bg-amber-500')} />
                  <Link href={`/customers/${c.id}`} className="font-semibold text-slate-900 hover:text-brand-700">{c.first_name} {c.last_name}</Link>
                </div>
                <p className="mt-1 text-xs text-slate-500">ID: {c.legacy_member_id || '—'}</p>
                <p className="text-xs text-slate-500">Plan: {c.plan || '—'}</p>
                <p className="text-xs text-slate-500">Joined: {d(c.joined)}</p>
                <p className="text-xs text-slate-500">Agent: {c.agent_name || '—'}</p>
              </div>
              <div className="text-xs"><p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Contact</p><p className="text-slate-600">{c.email || '—'}</p><p className="text-slate-600">{c.phone || '—'}</p></div>
              <div className="text-xs"><p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Documents</p><p className="text-slate-600">License: {c.license_no || '—'}</p><p className="text-slate-600">DOT: {c.dot} · {c.state || '—'}</p></div>
              <div className="text-xs"><p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Status</p><p className="text-slate-600">Pay: {c.pay_channel || '—'}</p><p><span className={'badge ' + subBadge(c.sub_status)}><span className="dot" />{c.sub_status}</span></p><p className={'mt-0.5 ' + (Number(c.overdue_amt) > 0 ? 'text-brand-600 font-medium' : 'text-slate-600')}>Next: {c.next_payment || '—'}</p></div>
              <div className="text-xs">
                <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Insights</p>
                <p className="text-slate-600">Invoices: {c.inv_paid} paid</p>
                <p className="text-slate-600">Cases: {c.cases}</p>
                {Number(c.overdue_amt) > 0 && <p className="text-brand-600">Overdue: {money(Number(c.overdue_amt))}</p>}
                <div className="mt-2 flex flex-col gap-1">
                  <Link href={`/customers/${c.id}`} className="chip text-center">View profile</Link>
                  <Link href="/cases/new" className="chip text-center">+ Add case</Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>Showing {total ? (cur - 1) * PAGE + 1 : 0}–{Math.min(cur * PAGE, total)} of {total} customers</span>
          <div className="flex items-center gap-1.5">
            <Link href={qs({ page: String(cur - 1) })} className={'chip ' + (cur <= 1 ? 'pointer-events-none opacity-50' : '')}>‹ Prev</Link>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => <Link key={p} href={qs({ page: String(p) })} className={'chip ' + (p === cur ? 'active' : '')}>{p}</Link>)}
            <Link href={qs({ page: String(cur + 1) })} className={'chip ' + (cur >= pages ? 'pointer-events-none opacity-50' : '')}>Next ›</Link>
          </div>
        </div>
      )}
    </div>
  )
}

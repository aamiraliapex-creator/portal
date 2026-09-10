import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()

export default async function Notifications() {
  await ensureSchemaOnce()
  const sql = getSql()
  const overdueFees = await sql<{ id: string; citation: string | null; official_no: string | null; customer_id: string; first_name: string; last_name: string; fee: string; paid: string; days: number }[]>`
    select k.id, k.citation, k.official_no, k.customer_id, c.first_name, c.last_name, k.fee,
      coalesce((select sum(p.amount) from payments p where p.case_id=k.id and p.status='Paid'),0) as paid,
      greatest(0, extract(day from now() - coalesce(k.fee_since, k.created_at))::int) as days
    from cases k join customers c on c.id=k.customer_id
    where k.fee is not null and k.fee > coalesce((select sum(p.amount) from payments p where p.case_id=k.id and p.status='Paid'),0)
    order by days desc`
  const unpaid = await sql<{ id: string; invoice: string | null; amount: string; customer_id: string; first_name: string; last_name: string }[]>`
    select p.id, p.invoice, p.amount, p.customer_id, c.first_name, c.last_name from payments p join customers c on c.id=p.customer_id where p.status in ('Pending','Overdue') order by p.paid_at desc`
  const items = [
    ...overdueFees.map((r) => ({ key: 'f' + r.id, tone: r.days > 20 ? 'rose' : 'amber', title: r.days > 20 ? `Overdue case payment (>20 days)` : 'Case balance due', body: `${r.first_name} ${r.last_name} owes ${money(Number(r.fee) - Number(r.paid))} for ${r.citation || r.official_no} · ${r.days} days`, href: `/customers/${r.customer_id}` })),
    ...unpaid.map((r) => ({ key: 'u' + r.id, tone: 'amber', title: 'Unpaid invoice', body: `${r.first_name} ${r.last_name} · ${r.invoice || ''} · ${money(Number(r.amount))}`, href: `/customers/${r.customer_id}` })),
  ]
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Notifications</h1>
      <p className="text-sm text-slate-500">Live alerts from your data (overdue balances &amp; unpaid invoices).</p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {items.length === 0 && <div className="p-12 text-center text-sm text-slate-500">You&apos;re all caught up.</div>}
        {items.map((n) => (
          <Link key={n.key} href={n.href} className="flex items-start gap-3 border-b border-slate-50 px-5 py-3 hover:bg-slate-50">
            <span className={'mt-1 inline-block h-2 w-2 rounded-full ' + (n.tone === 'rose' ? 'bg-brand-600' : 'bg-gold-500')} />
            <div><p className="text-sm font-medium text-slate-800">{n.title}</p><p className="text-sm text-slate-500">{n.body}</p></div>
          </Link>
        ))}
      </div>
    </div>
  )
}

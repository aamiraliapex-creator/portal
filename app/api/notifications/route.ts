import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getSession } from '@/lib/session'
export const runtime = 'nodejs'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()

export async function GET() {
  const s = await getSession(); if (!s) return NextResponse.json({ items: [] })
  try {
    await ensureSchemaOnce()
    const sql = getSql()
    const owing = await sql<{ citation: string | null; official_no: string | null; customer_id: string; first_name: string; last_name: string; fee: string; paid: string; days: number }[]>`
      select k.citation, k.official_no, k.customer_id, c.first_name, c.last_name, k.fee,
        coalesce((select sum(p.amount) from payments p where p.case_id=k.id and p.status='Paid'),0) as paid,
        greatest(0, extract(day from now() - coalesce(k.fee_since, k.created_at))::int) as days
      from cases k join customers c on c.id=k.customer_id
      where k.fee is not null and k.fee > coalesce((select sum(p.amount) from payments p where p.case_id=k.id and p.status='Paid'),0)
      order by days desc`
    const unpaid = await sql<{ invoice: string | null; amount: string; customer_id: string; first_name: string; last_name: string }[]>`
      select p.invoice, p.amount, p.customer_id, c.first_name, c.last_name from payments p join customers c on c.id=p.customer_id where p.status in ('Pending','Overdue') order by p.paid_at desc`
    const items = [
      ...owing.map((r) => ({ tone: r.days > 20 ? 'rose' : 'amber', title: r.days > 20 ? 'Payment overdue (>20 days)' : 'Case balance due', body: `${money(Number(r.fee) - Number(r.paid))} unpaid · ${r.first_name} ${r.last_name} · ${r.citation || r.official_no} · ${r.days} days`, href: `/customers/${r.customer_id}` })),
      ...unpaid.map((r) => ({ tone: 'amber', title: 'Unpaid invoice', body: `${money(Number(r.amount))} · ${r.first_name} ${r.last_name} · ${r.invoice || ''}`, href: `/customers/${r.customer_id}` })),
    ]
    return NextResponse.json({ items })
  } catch { return NextResponse.json({ items: [] }) }
}

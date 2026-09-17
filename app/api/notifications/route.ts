import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { getViewerScope } from '@/lib/ownership'
export const runtime = 'nodejs'

/**
 * Financial alerts. Callers without financial access get an empty, amount-free
 * payload rather than balances and customer names; callers with access but a
 * scoped role only see their own customers' figures.
 */
export async function GET() {
  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!scope.showMoney) return NextResponse.json({ items: [], count: 0 })

  // Financial records follow the financial-scope policy, not operational scope.
  const scoped = !scope.allMoney
  const { viewerId } = scope
  const sql = getSql()

  const overdue = await sql<{ id: string; label: string; sub: string; days: number }[]>`
    select k.id,
           ('$' || (k.fee - coalesce((select sum(p.amount) from payments p where p.case_id = k.id and p.status = 'Paid'), 0))
             || ' unpaid · ' || coalesce(k.citation, k.official_no, 'case')) as label,
           (c.first_name || ' ' || c.last_name) as sub,
           greatest(0, extract(day from now() - coalesce(k.fee_since, k.created_at))::int) as days
      from cases k join customers c on c.id = k.customer_id
     where k.fee is not null
       and k.fee > coalesce((select sum(p.amount) from payments p where p.case_id = k.id and p.status = 'Paid'), 0)
       and coalesce(k.approval_status,'ACTIVE') = 'ACTIVE'
       and (${scoped} = false or k.agent_id = ${viewerId})
     order by days desc limit 10`

  const unpaid = await sql<{ id: string; invoice: string | null; amount: string; first_name: string; last_name: string }[]>`
    select p.id, p.invoice, p.amount, c.first_name, c.last_name
      from payments p join customers c on c.id = p.customer_id
     where p.status in ('Pending','Overdue')
       and coalesce(c.approval_status,'ACTIVE') = 'ACTIVE'
       and (${scoped} = false or c.agent_id = ${viewerId})
     order by p.paid_at desc limit 10`

  const items = [
    ...overdue.map((o) => ({ kind: 'fee', title: o.label, sub: `${o.sub} · ${o.days} days` })),
    ...unpaid.map((u) => ({ kind: 'invoice', title: `${u.invoice || 'Invoice'} · $${Number(u.amount).toLocaleString()}`, sub: `${u.first_name} ${u.last_name}` })),
  ]
  return NextResponse.json({ items, count: items.length })
}

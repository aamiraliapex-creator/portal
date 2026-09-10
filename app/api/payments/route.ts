import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getSession } from '@/lib/session'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchemaOnce()
  const b = await req.json().catch(() => ({}))
  const amount = Number(b.amount)
  if (!b.customerId) return NextResponse.json({ error: 'Customer is required.' }, { status: 400 })
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
  const sql = getSql()
  const invoice = 'INV-' + Date.now().toString().slice(-7)
  const [row] = await sql<{ id: string }[]>`
    insert into payments (customer_id, case_id, kind, method, amount, status, invoice)
    values (${b.customerId}, ${b.caseId || null}, ${b.kind || 'Membership'}, ${b.method || 'Card'},
            ${amount}, ${b.status || 'Paid'}, ${invoice})
    returning id`
  return NextResponse.json({ ok: true, id: row.id, invoice })
}

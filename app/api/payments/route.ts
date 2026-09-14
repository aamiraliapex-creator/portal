import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getCurrentUser, canWriteBusinessData } from '@/lib/authz'
export const runtime = 'nodejs'

const KINDS = ['Membership', 'Case'] as const
const METHODS = ['Card', 'Zelle', 'ACH', 'Cash', 'Check'] as const
const STATUSES = ['Paid', 'Pending', 'Overdue'] as const

export async function POST(req: Request) {
  const actor = await getCurrentUser()
  if (!canWriteBusinessData(actor)) return NextResponse.json({ error: 'You do not have permission to record payments.' }, { status: 403 })
  await ensureSchemaOnce()
  const b = await req.json().catch(() => ({}))

  const amount = Number(b.amount)
  if (!b.customerId) return NextResponse.json({ error: 'Customer is required.' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })

  const kind = b.kind || 'Membership'
  const method = b.method || 'Card'
  const status = b.status || 'Paid'
  if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'Invalid payment kind.' }, { status: 400 })
  if (!(METHODS as readonly string[]).includes(method)) return NextResponse.json({ error: 'Invalid payment method.' }, { status: 400 })
  if (!(STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: 'Invalid payment status.' }, { status: 400 })

  const sql = getSql()

  // Confirm the customer actually exists.
  const [customer] = await sql<{ id: string }[]>`select id from customers where id = ${b.customerId} limit 1`
  if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })

  // A "Case" payment must reference a real case that belongs to this same customer — the
  // UI already filters the case dropdown by customer, but that's client-side convenience,
  // not enforcement; a stale selection or a direct API call could otherwise attach a
  // payment to someone else's case.
  let caseId: string | null = null
  if (kind === 'Case') {
    if (!b.caseId) return NextResponse.json({ error: 'Select a case for a case payment.' }, { status: 400 })
    const [kase] = await sql<{ id: string }[]>`select id from cases where id = ${b.caseId} and customer_id = ${b.customerId} limit 1`
    if (!kase) return NextResponse.json({ error: 'That case does not belong to the selected customer.' }, { status: 400 })
    caseId = b.caseId
  }

  const invoice = 'INV-' + Date.now().toString().slice(-7)
  const [row] = await sql<{ id: string }[]>`
    insert into payments (customer_id, case_id, kind, method, amount, status, invoice)
    values (${b.customerId}, ${caseId}, ${kind}, ${method}, ${amount}, ${status}, ${invoice})
    returning id`
  return NextResponse.json({ ok: true, id: row.id, invoice })
}

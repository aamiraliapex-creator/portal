import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { requirePermission, authzResponse } from '@/lib/auth-server'
export const runtime = 'nodejs'

const KINDS = ['Membership', 'Case'] as const
const METHODS = ['Card', 'Zelle', 'ACH', 'Cash', 'Check'] as const
const STATUSES = ['Paid', 'Pending', 'Overdue'] as const
const MAX_AMOUNT = 1_000_000

export async function POST(req: Request) {
  try {
    await requirePermission('payment.create')
    const b = await req.json().catch(() => ({}))

    const customerId = typeof b.customerId === 'string' ? b.customerId.trim() : ''
    const caseId = typeof b.caseId === 'string' && b.caseId.trim() !== '' ? b.caseId.trim() : null
    const kind = b.kind ?? 'Membership'
    const method = b.method ?? 'Card'
    const status = b.status ?? 'Paid'

    if (!customerId) return NextResponse.json({ error: 'Customer is required.' }, { status: 400 })
    if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'Invalid payment kind.' }, { status: 400 })
    if (!(METHODS as readonly string[]).includes(method)) return NextResponse.json({ error: 'Invalid payment method.' }, { status: 400 })
    if (!(STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: 'Invalid payment status.' }, { status: 400 })

    // Reject NaN, Infinity, negatives, zero and absurd values; store 2dp.
    const amount = typeof b.amount === 'number' ? b.amount : Number(String(b.amount ?? '').trim())
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return NextResponse.json({ error: 'Enter a valid amount greater than 0.' }, { status: 400 })
    }
    const rounded = Math.round(amount * 100) / 100

    const sql = getSql()
    const [customer] = await sql<{ id: string; approval_status: string }[]>`
      select id, coalesce(approval_status,'ACTIVE') as approval_status from customers where id = ${customerId} limit 1`
    if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
    // Money must never be recorded against a customer that has not been approved.
    if (customer.approval_status !== 'ACTIVE') {
      return NextResponse.json({ error: 'That customer is awaiting approval. Payments can only be recorded once it is approved.' }, { status: 400 })
    }

    // A case payment must name a case, and that case must belong to this customer.
    if (kind === 'Case' && !caseId) {
      return NextResponse.json({ error: 'Select the case this payment applies to.' }, { status: 400 })
    }
    if (caseId) {
      const [kase] = await sql<{ id: string; customer_id: string; approval_status: string }[]>`
        select id, customer_id, coalesce(approval_status,'ACTIVE') as approval_status from cases where id = ${caseId} limit 1`
      if (!kase) return NextResponse.json({ error: 'Case not found.' }, { status: 404 })
      if (kase.customer_id !== customerId) {
        return NextResponse.json({ error: 'That case does not belong to the selected customer.' }, { status: 400 })
      }
      // Money must never be recorded against a case that has not been approved.
      if (kase.approval_status !== 'ACTIVE') {
        return NextResponse.json({ error: 'That case is awaiting approval. Payments can only be recorded once it is approved.' }, { status: 400 })
      }
    }
    // Membership payments are never linked to a case.
    const linkedCaseId = kind === 'Case' ? caseId : null

    const invoice = 'INV-' + Date.now().toString().slice(-7)
    const [row] = await sql<{ id: string }[]>`
      insert into payments (customer_id, case_id, kind, method, amount, status, invoice)
      values (${customerId}, ${linkedCaseId}, ${kind}, ${method}, ${rounded}, ${status}, ${invoice})
      returning id`
    return NextResponse.json({ ok: true, id: row.id, invoice })
  } catch (e) { return authzResponse(e) ?? NextResponse.json({ error: 'Request failed.' }, { status: 500 }) }
}

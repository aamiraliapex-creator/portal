import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { LIMITS, parseText } from '@/lib/validation'
export const runtime = 'nodejs'

const KINDS = ['customer', 'case'] as const
const DECISIONS = ['APPROVE', 'REJECT'] as const

/** Approve or reject a pending customer/case. Admin and Super Admin only. */
export const POST = guarded('record.approve', async (req, actor) => {
  const b = await req.json().catch(() => ({}))
  const kind = b.kind
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  const decision = b.decision
  const reason = parseText(b.reason, LIMITS.shortText, 'Reason')

  if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'Unknown record type.' }, { status: 400 })
  if (!id) return NextResponse.json({ error: 'A record id is required.' }, { status: 400 })
  if (!(DECISIONS as readonly string[]).includes(decision)) return NextResponse.json({ error: 'Decision must be APPROVE or REJECT.' }, { status: 400 })
  if (!reason.ok) return NextResponse.json({ error: reason.error }, { status: 400 })

  const status = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED'
  const sql = getSql()

  // RETURNING tells us whether the row existed and was actually pending.
  const updated = kind === 'customer'
    ? await sql<{ id: string }[]>`
        update customers set approval_status = ${status}, approved_by = ${actor.id}, approved_at = now(),
                             rejection_reason = ${decision === 'REJECT' ? (reason.value ?? null) : null}
        where id = ${id} and coalesce(approval_status,'ACTIVE') = 'PENDING' returning id`
    : await sql<{ id: string }[]>`
        update cases set approval_status = ${status}, approved_by = ${actor.id}, approved_at = now(),
                         rejection_reason = ${decision === 'REJECT' ? (reason.value ?? null) : null}
        where id = ${id} and coalesce(approval_status,'ACTIVE') = 'PENDING' returning id`

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Record not found, or it is not awaiting approval.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, status })
})

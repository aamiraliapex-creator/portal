import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { getSession } from '@/lib/session'
import { stateToTz } from '@/lib/timezones'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b.customerId) return NextResponse.json({ error: 'Customer is required.' }, { status: 400 })
  if (!b.citation && !b.officialNo) return NextResponse.json({ error: 'Citation or official number is required.' }, { status: 400 })
  const fee = b.fee ? Number(b.fee) : null
  const hearingAt = b.hearingAt ? new Date(b.hearingAt) : null
  const hearingTz = hearingAt ? stateToTz(b.state || null) : null
  const sql = getSql()
  const [row] = await sql<{ id: string }[]>`
    insert into cases (customer_id, citation, official_no, court, state, status, priority, cmv, cdl, fine, fee, fee_since, agent_id, hearing_at, hearing_tz, hearing_type, prep_status)
    values (${b.customerId}, ${b.citation || null}, ${b.officialNo || null}, ${b.court || null}, ${b.state || null},
            ${b.status || 'New'}, ${b.priority || 'Normal'}, ${b.cmv || 'Unknown'}, ${b.cdl || 'Unknown'},
            ${b.fine ? Number(b.fine) : null}, ${fee}, ${fee && fee > 0 ? new Date() : null}, ${b.agentId || null},
            ${hearingAt}, ${hearingTz}, ${b.hearingType || 'In person'}, ${b.prepStatus || 'Not started'})
    returning id`
  return NextResponse.json({ ok: true, id: row.id })
}

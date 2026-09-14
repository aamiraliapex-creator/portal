import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { getCurrentUser, canWriteBusinessData } from '@/lib/authz'
import { stateToTz } from '@/lib/timezones'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const actor = await getCurrentUser()
  if (!canWriteBusinessData(actor)) return NextResponse.json({ error: 'You do not have permission to schedule hearings.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.caseId) return NextResponse.json({ error: 'Case is required.' }, { status: 400 })
  const sql = getSql()
  const [existing] = await sql<{ state: string | null }[]>`select state from cases where id = ${b.caseId} limit 1`
  if (!existing) return NextResponse.json({ error: 'Case not found.' }, { status: 404 })
  const hearingAt = b.hearingAt ? new Date(b.hearingAt) : null
  const hearingTz = hearingAt ? stateToTz(b.state ?? existing.state) : null
  await sql`
    update cases set
      hearing_at = ${hearingAt},
      hearing_tz = ${hearingTz},
      hearing_type = ${b.hearingType || 'In person'},
      prep_status = ${b.prepStatus || 'Not started'},
      status = ${b.status || 'Hearing Scheduled'}
    where id = ${b.caseId}`
  return NextResponse.json({ ok: true })
}

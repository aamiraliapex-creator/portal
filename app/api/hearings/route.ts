import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { getViewerScope, loadOwnedCase } from '@/lib/ownership'
import { stateToTz } from '@/lib/timezones'
import { CASE_STATUSES, HEARING_TYPES, PREP_STATUSES, LIMITS, pickEnum, parseText, parseDate, firstError } from '@/lib/validation'
export const runtime = 'nodejs'

export const POST = guarded('case.update', async (req) => {
  const b = await req.json().catch(() => ({}))
  const caseId = typeof b.caseId === 'string' ? b.caseId.trim() : ''
  if (!caseId) return NextResponse.json({ error: 'Case is required.' }, { status: 400 })

  const hearingType = pickEnum(b.hearingType, HEARING_TYPES, 'In person', 'hearing type')
  const prepStatus = pickEnum(b.prepStatus, PREP_STATUSES, 'Not started', 'preparation status')
  const status = pickEnum(b.status, CASE_STATUSES, 'Hearing Scheduled', 'case status')
  const state = parseText(b.state, LIMITS.state, 'State')
  const hearingAt = parseDate(b.hearingAt, 'Hearing date')

  const bad = firstError(hearingType, prepStatus, status, state, hearingAt)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Object-level check: a scoped agent may only touch their own case, and the
  // case must be approved. A missing case and someone else's case are
  // indistinguishable to the caller (404, no existence oracle).
  const kase = await loadOwnedCase(scope, caseId, { requireActive: true })
  if (!kase) return NextResponse.json({ error: 'Not available' }, { status: 404 })

  const sql = getSql()
  const hearingTz = hearingAt.value ? stateToTz(state.value ?? kase.state) : null
  await sql`
    update cases set
      hearing_at = ${hearingAt.value ?? null},
      hearing_tz = ${hearingTz},
      hearing_type = ${hearingType.value ?? 'In person'},
      prep_status = ${prepStatus.value ?? 'Not started'},
      status = ${status.value ?? 'Hearing Scheduled'}
    where id = ${caseId}`
  return NextResponse.json({ ok: true })
})

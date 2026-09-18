import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { getViewerScope, loadOwnedCase } from '@/lib/ownership'
import { isValidTimeZone } from '@/lib/hearing-time'
import { stateToTzStrict } from '@/lib/timezones'
import { CASE_STATUSES, HEARING_TYPES, PREP_STATUSES, LIMITS, pickEnum, parseText, parseDate, firstError } from '@/lib/validation'
import { reconcileCaseHearing } from '@/lib/reminders'
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

  // A court date must never be stored with a silently-guessed timezone.
  // Accept an explicitly selected valid IANA zone, otherwise require a
  // RECOGNISED state. Nothing here falls back to Pacific.
  let hearingTz: string | null = null
  if (hearingAt.value) {
    const supplied = typeof b.hearingTz === 'string' ? b.hearingTz.trim() : ''
    if (supplied) {
      if (!isValidTimeZone(supplied)) {
        return NextResponse.json({ error: 'Select a valid court timezone.' }, { status: 400 })
      }
      hearingTz = supplied
    } else {
      const fromState = stateToTzStrict(state.value ?? kase.state)
      if (!fromState) {
        return NextResponse.json({
          error: 'A recognised state or an explicitly selected court timezone is required for a hearing date.',
        }, { status: 400 })
      }
      hearingTz = fromState
    }
  }

  // The case update and the reminder reconciliation happen in ONE transaction.
  // If reconciliation fails the case change is rolled back, so a 200 response
  // always means obsolete reminders are no longer active.
  try {
    await sql.begin(async (tx) => {
      await tx`
        update cases set
          hearing_at = ${hearingAt.value ?? null},
          hearing_tz = ${hearingTz},
          hearing_type = ${hearingType.value ?? 'In person'},
          prep_status = ${prepStatus.value ?? 'Not started'},
          status = ${status.value ?? 'Hearing Scheduled'}
        where id = ${caseId}`
      await reconcileCaseHearing(caseId, new Date(), tx as unknown as ReturnType<typeof getSql>)
    })
  } catch (e) {
    console.error('hearing update rolled back:', e instanceof Error ? e.message : 'error')
    return NextResponse.json(
      { error: 'Could not update the hearing and its reminders. No changes were saved.' },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
})

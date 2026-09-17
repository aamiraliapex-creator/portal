import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { isAssignableAgentRole } from '@/lib/authz'
import { stateToTz } from '@/lib/timezones'
import {
  CASE_STATUSES, CASE_PRIORITIES, TRISTATE, HEARING_TYPES, PREP_STATUSES, LIMITS,
  pickEnum, parseText, parseMoney, parseDate, firstError,
} from '@/lib/validation'
import { initialApprovalStatus } from '@/lib/authz'
import { getViewerScope, loadOwnedCustomer } from '@/lib/ownership'
export const runtime = 'nodejs'

export const POST = guarded('case.create', async (req, actor) => {
  const b = await req.json().catch(() => ({}))

  const customerId = typeof b.customerId === 'string' ? b.customerId.trim() : ''
  if (!customerId) return NextResponse.json({ error: 'Customer is required.' }, { status: 400 })

  // Text: trimmed and length-limited.
  const citation = parseText(b.citation, LIMITS.shortText, 'Citation number')
  const officialNo = parseText(b.officialNo, LIMITS.shortText, 'Official case number')
  const court = parseText(b.court, LIMITS.shortText, 'Court name')
  const courtPhone = parseText(b.courtPhone, LIMITS.tinyText, 'Court phone number')
  const state = parseText(b.state, LIMITS.state, 'State')

  // Enums: allowlisted, never free text.
  const status = pickEnum(b.status, CASE_STATUSES, 'New', 'case status')
  const priority = pickEnum(b.priority, CASE_PRIORITIES, 'Normal', 'priority')
  const cmv = pickEnum(b.cmv, TRISTATE, 'Unknown', 'CMV value')
  const cdl = pickEnum(b.cdl, TRISTATE, 'Unknown', 'CDL value')
  const hearingType = pickEnum(b.hearingType, HEARING_TYPES, 'In person', 'hearing type')
  const prepStatus = pickEnum(b.prepStatus, PREP_STATUSES, 'Not started', 'preparation status')

  // Money: rejects NaN, Infinity, negative and excessive values.
  const fine = parseMoney(b.fine, 'Fine')
  const fee = parseMoney(b.fee, 'Customer fee')

  const hearingAt = parseDate(b.hearingAt, 'Hearing date')
  const violationDate = parseDate(b.violationDate, 'Violation date')

  const bad = firstError(citation, officialNo, court, courtPhone, state, status, priority, cmv, cdl,
    hearingType, prepStatus, fine, fee, hearingAt, violationDate)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  if (!citation.value && !officialNo.value) {
    return NextResponse.json({ error: 'Citation or official number is required.' }, { status: 400 })
  }

  const sql = getSql()

  // Referential integrity: never write a row pointing at something that doesn't exist.
  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Never trust the form: an actor without financial access cannot set money,
  // even with a handcrafted request.
  if (!scope.showMoney && (fine.value != null || fee.value != null)) {
    return NextResponse.json({ error: 'You do not have permission to set financial values on a case.' }, { status: 403 })
  }

  // A scoped agent may only open a case for an ACTIVE customer assigned to them.
  // Unknown and not-yours are answered identically.
  const customer = await loadOwnedCustomer(scope, customerId)
  if (!customer) return NextResponse.json({ error: 'Not available' }, { status: 404 })
  if (customer.approval_status !== 'ACTIVE') {
    return NextResponse.json({ error: 'That customer is awaiting approval. Cases can only be added once it is approved.' }, { status: 400 })
  }

  let agentId: string | null = null
  // A scoped agent cannot hand the case to somebody else: it is always theirs.
  if (scope.scoped) {
    if (typeof b.agentId === 'string' && b.agentId.trim() !== '' && b.agentId.trim() !== scope.viewerId) {
      return NextResponse.json({ error: 'You can only create cases assigned to yourself.' }, { status: 403 })
    }
    agentId = scope.viewerId
  } else if (typeof b.agentId === 'string' && b.agentId.trim() !== '') {
    const [agent] = await sql<{ id: string; role: string }[]>`
      select id, role from users where id = ${b.agentId.trim()} and status = 'ACTIVE' limit 1`
    if (!agent) return NextResponse.json({ error: 'Assigned agent not found or inactive.' }, { status: 400 })
    if (!isAssignableAgentRole(agent.role)) {
      return NextResponse.json({ error: 'That user cannot be assigned as an agent.' }, { status: 400 })
    }
    agentId = agent.id
  }

  const hearingTz = hearingAt.value ? stateToTz(state.value ?? null) : null
  const [row] = await sql<{ id: string }[]>`
    insert into cases (approval_status, created_by, customer_id, citation, official_no, court, court_phone, state, status, priority, cmv, cdl, fine, fee, fee_since, agent_id, hearing_at, hearing_tz, hearing_type, prep_status)
    values (${initialApprovalStatus(actor.role)}, ${actor.id}, ${customerId}, ${citation.value ?? null}, ${officialNo.value ?? null}, ${court.value ?? null}, ${courtPhone.value ?? null}, ${state.value ?? null},
            ${status.value ?? 'New'}, ${priority.value ?? 'Normal'}, ${cmv.value ?? 'Unknown'}, ${cdl.value ?? 'Unknown'},
            ${fine.value ?? null}, ${fee.value ?? null}, ${fee.value && fee.value > 0 ? new Date() : null}, ${agentId},
            ${hearingAt.value ?? null}, ${hearingTz}, ${hearingType.value ?? 'In person'}, ${prepStatus.value ?? 'Not started'})
    returning id`
  return NextResponse.json({ ok: true, id: row.id })
})

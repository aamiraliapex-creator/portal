import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { isAssignableAgentRole } from '@/lib/authz'
import {
  PLANS, SUB_STATUSES, PAY_CHANNELS, YES_NO, LIMITS,
  pickEnum, parseText, parseDateOnly, firstError,
} from '@/lib/validation'
import { initialApprovalStatus } from '@/lib/authz'
export const runtime = 'nodejs'

export const POST = guarded('customer.create', async (req, actor) => {
  const b = await req.json().catch(() => ({}))

  const firstName = parseText(b.firstName, LIMITS.shortText, 'First name')
  const lastName = parseText(b.lastName, LIMITS.shortText, 'Last name')
  const email = parseText(b.email, LIMITS.shortText, 'Email')
  const phone = parseText(b.phone, LIMITS.tinyText, 'Phone')
  const state = parseText(b.state, LIMITS.state, 'State')
  const licenseNo = parseText(b.licenseNo, LIMITS.shortText, 'Driver license number')

  const plan = pickEnum(b.plan, PLANS, null, 'plan')
  const subStatus = pickEnum(b.subStatus, SUB_STATUSES, 'Active', 'subscription status')
  const payChannel = pickEnum(b.payChannel, PAY_CHANNELS, null, 'payment channel')
  const cdl = pickEnum(b.cdl, YES_NO, 'No', 'CDL value')
  const dot = pickEnum(b.dot, YES_NO, 'No', 'DOT value')

  const dob = parseDateOnly(b.dob, 'Date of birth')
  const nextPayment = parseDateOnly(b.nextPayment, 'Next payment date')

  const bad = firstError(firstName, lastName, email, phone, state, licenseNo,
    plan, subStatus, payChannel, cdl, dot, dob, nextPayment)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  if (!firstName.value || !lastName.value) {
    return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 })
  }
  if (email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  if (dob.value && dob.value > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: 'Date of birth cannot be in the future.' }, { status: 400 })
  }

  const sql = getSql()

  // The agent must exist, be active, and hold a role permitted to own customers.
  let agentId: string | null = null
  if (typeof b.agentId === 'string' && b.agentId.trim() !== '') {
    const [agent] = await sql<{ id: string; role: string }[]>`
      select id, role from users where id = ${b.agentId.trim()} and status = 'ACTIVE' limit 1`
    if (!agent) return NextResponse.json({ error: 'Assigned agent not found or inactive.' }, { status: 400 })
    if (!isAssignableAgentRole(agent.role)) {
      return NextResponse.json({ error: 'That user cannot be assigned as an agent.' }, { status: 400 })
    }
    agentId = agent.id
  }

  const [row] = await sql<{ id: string }[]>`
    insert into customers (approval_status, created_by, legacy_member_id, first_name, last_name, dob, email, phone, state, plan, pay_channel, cdl, license_no, dot, sub_status, next_payment, next_payment_date, agent_id)
    values (${initialApprovalStatus(actor.role)}, ${actor.id}, ${'M-' + Math.floor(1000 + Math.random() * 9000)}, ${firstName.value}, ${lastName.value}, ${dob.value ?? null}, ${email.value ?? null}, ${phone.value ?? null}, ${state.value ?? null},
            ${plan.value ?? null}, ${payChannel.value ?? null}, ${cdl.value ?? 'No'}, ${licenseNo.value ?? null}, ${dot.value ?? 'No'},
            ${subStatus.value ?? 'Active'}, ${nextPayment.value ?? null}, ${nextPayment.value ?? null}, ${agentId})
    returning id`
  return NextResponse.json({ ok: true, id: row.id })
})

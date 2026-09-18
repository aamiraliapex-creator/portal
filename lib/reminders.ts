import { getSql } from './db'
import {
  HEARING_INTERVALS, NON_REMINDING_CASE_STATUSES, TZ_REVIEW_WARNING, applicableIntervals, formatCourtLocal,
  hearingEventKey, resolveHearingTzDetailed, tzAbbreviation,
} from './hearing-time'
import { ROLES, canSeeMoney, seesAllRecords, type Role } from './authz'

/** Roles permitted to receive financial notifications. */
const MONEY_ROLE_NAMES: Role[] = ROLES.filter((r) => canSeeMoney(r))

export type GenerationResult = { created: number; cancelled: number; escalated: number; skipped: number; failed: number }

const emptyResult = (): GenerationResult => ({ created: 0, cancelled: 0, escalated: 0, skipped: 0, failed: 0 })

/** Management roles that also receive hearing reminders. */
const MANAGEMENT_ROLES: Role[] = ROLES.filter((r) => seesAllRecords(r))

async function managementRecipients(sql: ReturnType<typeof getSql>): Promise<{ id: string }[]> {
  return sql<{ id: string }[]>`
    select id from users where status = 'ACTIVE' and role = any(${MANAGEMENT_ROLES as unknown as string[]})`
}

/**
 * Inserts a notification. The unique constraint is the final duplicate
 * defence: a concurrent scheduler run hits ON CONFLICT DO NOTHING and creates
 * nothing, so overlapping executions are safe.
 */
async function insertNotification(
  sql: ReturnType<typeof getSql>,
  n: {
    recipient: string; type: string; priority: string; sourceType: string; sourceId: string | null
    eventKey: string; title: string; message: string; actionUrl: string | null
    eventAt: Date | null; scheduledFor: Date
  },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    insert into notifications
      (recipient_user_id, type, priority, source_type, source_id, event_key, title, message, action_url, event_at, scheduled_for)
    values (${n.recipient}, ${n.type}, ${n.priority}, ${n.sourceType}, ${n.sourceId}, ${n.eventKey},
            ${n.title}, ${n.message}, ${n.actionUrl}, ${n.eventAt}, ${n.scheduledFor})
    on conflict (recipient_user_id, source_type, source_id, event_key) do nothing
    returning id`
  return rows.length > 0
}

type HearingCase = {
  id: string; citation: string | null; official_no: string | null; court: string | null
  court_phone: string | null; hearing_at: Date; hearing_tz: string | null; hearing_type: string | null
  state: string | null; status: string; approval_status: string; agent_id: string | null
  first_name: string; last_name: string; agent_name: string | null
}

/**
 * Cancels every future, undelivered reminder whose event key does not match
 * the case's current schedule. This is what makes rescheduling safe: a
 * reminder carrying an old hearing date can never be delivered afterwards.
 */
async function cancelObsoleteHearingReminders(
  sql: ReturnType<typeof getSql>, caseId: string, validKeys: string[],
): Promise<number> {
  // Cancels pending AND already-delivered rows. A delivered reminder carrying
  // an old hearing date must vanish from the feed immediately and must never
  // escalate. Rows are cancelled, never deleted, so history stays auditable.
  const rows = await sql<{ id: string }[]>`
    update notifications set cancelled_at = now()
     where source_type = 'case'
       and source_id = ${caseId}
       and type = 'hearing'
       and cancelled_at is null
       and not (event_key = any(${validKeys}))
    returning id`
  return rows.length
}

/**
 * Cancels every active hearing notification for a case whose recipient is no
 * longer entitled to it: the former agent after a reassignment, and anyone who
 * is no longer the assigned agent or an ACTIVE management user (demoted,
 * disabled or deleted). Rows are cancelled, never deleted.
 */
async function cancelUnentitledRecipients(
  sql: ReturnType<typeof getSql>, caseId: string, agentId: string | null,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update notifications n set cancelled_at = now()
     where n.source_type = 'case' and n.source_id = ${caseId}
       and n.type = 'hearing' and n.cancelled_at is null
       and (${agentId}::text is null or n.recipient_user_id <> ${agentId})
       and not exists (
         select 1 from users u
          where u.id = n.recipient_user_id
            and u.status = 'ACTIVE'
            and u.role = any(${MANAGEMENT_ROLES as unknown as string[]}))
    returning n.id`
  return rows.length
}

/**
 * Brings one case's hearing reminders into line with its current state.
 * Safe to call from an authorised API write (immediate invalidation) and from
 * cron (recovery). Returns counts.
 */
export async function reconcileCaseHearing(
  caseId: string,
  now: Date = new Date(),
  conn?: ReturnType<typeof getSql>,
): Promise<GenerationResult> {
  // Accepts a transaction connection so the caller can make the case update and
  // the reminder reconciliation atomic.
  const sql = conn ?? getSql()
  const res = emptyResult()
  const [k] = await sql<HearingCase[]>`
    select k.id, k.citation, k.official_no, k.court, k.court_phone, k.hearing_at, k.hearing_tz,
           k.hearing_type, k.state, k.status, coalesce(k.approval_status,'ACTIVE') as approval_status,
           k.agent_id, c.first_name, c.last_name, u.name as agent_name
      from cases k
      join customers c on c.id = k.customer_id
      left join users u on u.id = k.agent_id
     where k.id = ${caseId} limit 1`
  if (!k) return res
  await reconcileOneCase(sql, k, await managementRecipients(sql), now, res)
  return res
}

/** Generates (and prunes) court-hearing reminders. Highest priority path. */
export async function generateHearingReminders(now: Date = new Date()): Promise<GenerationResult> {
  const sql = getSql()
  const res = emptyResult()

  const cases = await sql<HearingCase[]>`
    select k.id, k.citation, k.official_no, k.court, k.court_phone, k.hearing_at, k.hearing_tz,
           k.hearing_type, k.state, k.status, coalesce(k.approval_status,'ACTIVE') as approval_status,
           k.agent_id, c.first_name, c.last_name, u.name as agent_name
      from cases k
      join customers c on c.id = k.customer_id
      left join users u on u.id = k.agent_id
     where k.hearing_at is not null
        -- also reconcile cases whose hearing was cleared directly in the
        -- database, so stale reminders cannot survive
        or exists (select 1 from notifications n
                    where n.source_type = 'case' and n.source_id = k.id
                      and n.type = 'hearing' and n.cancelled_at is null)`

  const management = await managementRecipients(sql)

  for (const k of cases) {
    try {
      await reconcileOneCase(sql, k, management, now, res)
    } catch (e) {
      // One bad case must never stop the rest.
      res.failed++
      console.error('hearing reminder generation failed for a case:', e instanceof Error ? e.message : 'error')
    }
  }
  return res
}

/** Shared per-case logic used by both cron and immediate API reconciliation. */
async function reconcileOneCase(
  sql: ReturnType<typeof getSql>,
  k: HearingCase,
  management: { id: string }[],
  now: Date,
  res: GenerationResult,
): Promise<void> {
  const inactive =
    k.approval_status !== 'ACTIVE' || NON_REMINDING_CASE_STATUSES.includes(k.status)

  // A cleared hearing date, or an inactive case, cancels everything.
  if (inactive || !k.hearing_at) {
    res.cancelled += await cancelObsoleteHearingReminders(sql, k.id, [])
    res.skipped++
    return
  }

  const resolution = resolveHearingTzDetailed(k.hearing_tz, k.state)
  const tz = resolution.tz
  const validKeys = HEARING_INTERVALS.map((i) => hearingEventKey(k.hearing_at, i.key, tz))
  res.cancelled += await cancelObsoleteHearingReminders(sql, k.id, validKeys)
  res.cancelled += await cancelUnentitledRecipients(sql, k.id, k.agent_id)

  const due = applicableIntervals(k.hearing_at, now)
  if (due.length === 0) { res.skipped++; return }

  const courtLocal = formatCourtLocal(k.hearing_at, tz)
  const abbr = tzAbbreviation(k.hearing_at, tz)
  const caseRef = k.citation || k.official_no || 'case'
  const customer = `${k.first_name} ${k.last_name}`
  const phone = k.court_phone ? ` · Court phone ${k.court_phone}` : ''
  const warning = resolution.needsReview ? `
${TZ_REVIEW_WARNING}` : ''
  const message =
    `${customer} — ${caseRef}
` +
    `${k.court || 'Court'}${phone}
` +
    `${k.hearing_type || 'In person'} hearing: ${courtLocal} (${abbr})
` +
    `Assigned agent: ${k.agent_name || 'unassigned'}` + warning

  const recipients = new Set<string>()
  if (k.agent_id) recipients.add(k.agent_id)
  for (const m of management) recipients.add(m.id)

  for (const interval of due) {
    const eventKey = hearingEventKey(k.hearing_at, interval.key, tz)
    const scheduledFor = new Date(new Date(k.hearing_at).getTime() - interval.minutes * 60_000)
    for (const recipient of recipients) {
      const created = await insertNotification(sql, {
        recipient, type: 'hearing',
        priority: interval.critical ? 'critical' : 'high',
        sourceType: 'case', sourceId: k.id, eventKey,
        title: `Hearing in ${interval.label}: ${caseRef}`,
        message, actionUrl: `/hearings/${k.id}`,
        eventAt: new Date(k.hearing_at), scheduledFor,
      })
      if (created) res.created++
    }
  }
}

/**
 * Escalates unacknowledged critical 24-hour hearing reminders to management.
 * escalated_at plus the unique constraint prevent duplicate escalation rows.
 */
/** Minutes after DELIVERY before an unacknowledged 24h reminder escalates. */
export const ESCALATION_GRACE_MINUTES = 30

/**
 * Escalates only the ASSIGNED AGENT's own unacknowledged 24-hour reminder.
 *
 * The join to cases.agent_id is what makes this correct: management receive
 * their own copies of every hearing reminder, and those copies must never
 * trigger an escalation. If the agent acknowledges, nothing escalates even
 * while management copies sit unacknowledged.
 */
export async function escalateUnacknowledgedHearings(now: Date = new Date()): Promise<number> {
  const sql = getSql()
  const management = await managementRecipients(sql)
  if (management.length === 0) return 0

  const stale = await sql<{ id: string; source_id: string; event_key: string; title: string; message: string; action_url: string | null; event_at: Date | null }[]>`
    select n.id, n.source_id, n.event_key, n.title, n.message, n.action_url, n.event_at
      from notifications n
      join cases k on k.id = n.source_id
     where n.type = 'hearing' and n.priority = 'critical'
       and n.event_key like '%:24h'
       and n.acknowledged_at is null
       and n.cancelled_at is null
       and n.delivery_status = 'delivered'
       and n.escalated_at is null
       -- the reminder must belong to the CURRENTLY assigned agent
       and k.agent_id is not null
       and n.recipient_user_id = k.agent_id
       -- grace period measured from actual delivery, never from scheduled_for
       and n.delivered_at is not null
       and n.delivered_at <= ${new Date(now.getTime() - ESCALATION_GRACE_MINUTES * 60_000)}
       -- the hearing must still be live and on this schedule
       and coalesce(k.approval_status,'ACTIVE') = 'ACTIVE'
       and not (k.status = any(${NON_REMINDING_CASE_STATUSES}))
       and k.hearing_at is not null
       and k.hearing_at > ${now}
       -- keys are hearing:<instant>:<tz>:<interval>, so match the instant and
       -- interval while allowing any resolved timezone segment
       and n.event_key like ('hearing:' || to_char(k.hearing_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':%:24h')`

  let escalated = 0
  for (const s of stale) {
    try {
      for (const m of management) {
        const created = await insertNotification(sql, {
          recipient: m.id, type: 'hearing', priority: 'critical',
          sourceType: 'case', sourceId: s.source_id,
          eventKey: `${s.event_key}:escalation`,
          title: `ESCALATION — unacknowledged: ${s.title}`,
          message: s.message, actionUrl: s.action_url,
          eventAt: s.event_at, scheduledFor: now,
        })
        if (created) escalated++
      }
      // Marking the original preserves it AND stops repeat escalation; combined
      // with the unique constraint this is safe under concurrent cron runs.
      await sql`update notifications set escalated_at = now() where id = ${s.id} and escalated_at is null`
    } catch (e) {
      console.error('escalation failed for a reminder:', e instanceof Error ? e.message : 'error')
    }
  }
  return escalated
}

/** Overdue-task reminders for the assigned user only. */
export async function generateTaskReminders(now: Date = new Date()): Promise<GenerationResult> {
  const sql = getSql()
  const res = emptyResult()
  const rows = await sql<{ id: string; title: string; priority: string; due_at: Date; assignee_id: string }[]>`
    select id, title, coalesce(priority,'Normal') as priority, due_at, assignee_id
      from tasks
     where assignee_id is not null and due_at is not null and due_at < now()
       and status in ('Open','In Progress')`
  for (const t of rows) {
    try {
      const day = new Date(t.due_at).toISOString().slice(0, 10)
      const created = await insertNotification(sql, {
        recipient: t.assignee_id, type: 'task', priority: t.priority === 'High' ? 'high' : 'normal',
        sourceType: 'task', sourceId: t.id, eventKey: `task-overdue:${day}`,
        title: `Overdue task: ${t.title}`,
        message: `Priority ${t.priority}. Was due ${day}.`,
        actionUrl: '/tasks', eventAt: new Date(t.due_at), scheduledFor: now,
      })
      if (created) res.created++
    } catch { res.failed++ }
  }
  // Completed or cancelled tasks stop reminding.
  const cancelled = await sql<{ id: string }[]>`
    update notifications set cancelled_at = now()
     where type = 'task' and cancelled_at is null
       and exists (select 1 from tasks t where t.id = notifications.source_id and t.status in ('Completed','Canceled'))
    returning id`
  res.cancelled += cancelled.length
  return res
}

/** Payment reminders. Only roles with financial access ever receive these. */
export async function generatePaymentReminders(now: Date = new Date()): Promise<GenerationResult> {
  const sql = getSql()
  const res = emptyResult()
  const financialUsers = await sql<{ id: string; role: string }[]>`
    select id, role from users where status = 'ACTIVE'`
  const recipients = financialUsers.filter((u) => canSeeMoney(u.role))
  if (recipients.length === 0) return res

  const upcoming = await sql<{ id: string; first_name: string; last_name: string; next_payment_date: Date }[]>`
    select id, first_name, last_name, next_payment_date from customers
     where next_payment_date is not null
       and next_payment_date >= current_date
       and next_payment_date <= current_date + 7
       and coalesce(approval_status,'ACTIVE') = 'ACTIVE'`

  // Overdue invoices and balances.
  const overdue = await sql<{ id: string; first_name: string; last_name: string; customer_id: string; invoice: string | null }[]>`
    select p.id, c.first_name, c.last_name, c.id as customer_id, p.invoice
      from payments p join customers c on c.id = p.customer_id
     where p.status in ('Pending','Overdue')
       and coalesce(c.approval_status,'ACTIVE') = 'ACTIVE'`
  for (const o of overdue) {
    for (const r of recipients) {
      try {
        const created = await insertNotification(sql, {
          recipient: r.id, type: 'payment', priority: 'high',
          sourceType: 'payment', sourceId: o.id, eventKey: 'invoice-overdue',
          title: `Unpaid invoice ${o.invoice || ''}`.trim(),
          message: `${o.first_name} ${o.last_name} has an outstanding invoice.`,
          actionUrl: `/customers/${o.customer_id}`, eventAt: null, scheduledFor: now,
        })
        if (created) res.created++
      } catch { res.failed++ }
    }
  }

  for (const c of upcoming) {
    const day = new Date(c.next_payment_date).toISOString().slice(0, 10)
    for (const r of recipients) {
      try {
        const created = await insertNotification(sql, {
          recipient: r.id, type: 'payment', priority: 'normal',
          sourceType: 'customer', sourceId: c.id, eventKey: `payment-due:${day}`,
          title: `Payment due ${day}`,
          message: `${c.first_name} ${c.last_name} has a payment scheduled for ${day}.`,
          actionUrl: `/customers/${c.id}`, eventAt: new Date(c.next_payment_date), scheduledFor: now,
        })
        if (created) res.created++
      } catch { res.failed++ }
    }
  }
  return res
}

/** Document-expiry reminders at 30/14/7/1 days and on expiry. */
export const DOCUMENT_INTERVALS = [30, 14, 7, 1, 0] as const

export async function generateDocumentReminders(now: Date = new Date()): Promise<GenerationResult> {
  const sql = getSql()
  const res = emptyResult()
  const management = await managementRecipients(sql)

  const docs = await sql<{ id: string; file_name: string; expires_on: Date; agent_id: string | null; customer_id: string | null }[]>`
    select d.id, d.file_name, d.expires_on,
           coalesce(c.agent_id, k.agent_id) as agent_id, d.customer_id
      from documents d
      left join customers c on c.id = d.customer_id
      left join cases k on k.id = d.case_id
     where d.expires_on is not null`

  for (const d of docs) {
    try {
      const days = Math.ceil((new Date(d.expires_on).getTime() - now.getTime()) / 86_400_000)
      const hit = DOCUMENT_INTERVALS.find((i) => i === days) ?? (days < 0 ? 0 : undefined)
      if (hit === undefined) { res.skipped++; continue }
      const recipients = new Set<string>()
      if (d.agent_id) recipients.add(d.agent_id)
      for (const m of management) recipients.add(m.id)
      const day = new Date(d.expires_on).toISOString().slice(0, 10)
      for (const recipient of recipients) {
        const created = await insertNotification(sql, {
          recipient, type: 'document', priority: hit === 0 ? 'high' : 'normal',
          sourceType: 'document', sourceId: d.id, eventKey: `doc-expiry:${day}:${hit}`,
          title: hit === 0 ? `Document expired: ${d.file_name}` : `Document expires in ${hit} days: ${d.file_name}`,
          message: `Expiry date ${day}.`,
          actionUrl: '/documents', eventAt: new Date(d.expires_on), scheduledFor: now,
        })
        if (created) res.created++
      }
    } catch { res.failed++ }
  }
  return res
}

/**
 * Cancels non-hearing reminders whose underlying schedule no longer holds:
 * a paid invoice, a changed or cleared next payment date, a changed or cleared
 * document expiry, and completed/cancelled/rescheduled tasks. Rows are
 * cancelled for audit, never deleted, and the replacement is created by the
 * normal generators exactly once.
 */
export async function cancelStaleNonHearingReminders(): Promise<number> {
  const sql = getSql()
  let cancelled = 0

  // Invoice settled or removed.
  const paid = await sql<{ id: string }[]>`
    update notifications set cancelled_at = now()
     where type = 'payment' and source_type = 'payment' and cancelled_at is null
       and not exists (select 1 from payments p
                        where p.id = notifications.source_id and p.status in ('Pending','Overdue'))
    returning id`
  cancelled += paid.length

  // Next payment date changed or cleared: the event key carries the date.
  const payments = await sql<{ id: string }[]>`
    update notifications set cancelled_at = now()
     where type = 'payment' and source_type = 'customer' and cancelled_at is null
       and not exists (select 1 from customers c
                        where c.id = notifications.source_id
                          and c.next_payment_date is not null
                          and notifications.event_key = 'payment-due:' || to_char(c.next_payment_date, 'YYYY-MM-DD'))
    returning id`
  cancelled += payments.length

  // Document expiry changed or cleared: the event key carries the date.
  const docs = await sql<{ id: string }[]>`
    update notifications set cancelled_at = now()
     where type = 'document' and cancelled_at is null
       and not exists (select 1 from documents d
                        where d.id = notifications.source_id
                          and d.expires_on is not null
                          and notifications.event_key like 'doc-expiry:' || to_char(d.expires_on, 'YYYY-MM-DD') || ':%')
    returning id`
  cancelled += docs.length

  // Task completed, cancelled, reassigned, or its due date moved.
  const tasks = await sql<{ id: string }[]>`
    update notifications set cancelled_at = now()
     where type = 'task' and cancelled_at is null
       and not exists (select 1 from tasks t
                        where t.id = notifications.source_id
                          and t.status in ('Open','In Progress')
                          and t.due_at is not null
                          and t.assignee_id = notifications.recipient_user_id
                          and notifications.event_key = 'task-overdue:' || to_char(t.due_at, 'YYYY-MM-DD'))
    returning id`
  cancelled += tasks.length

  return cancelled
}

/** Marks due pending reminders delivered (in-app delivery). */
export async function deliverDueReminders(now: Date = new Date()): Promise<number> {
  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    update notifications
       set delivery_status = 'delivered', delivered_at = now(), delivery_attempts = delivery_attempts + 1
     where delivery_status = 'pending'
       and cancelled_at is null
       and scheduled_for <= ${now}
    returning id`
  return rows.length
}

/** Retention: remove long-dead rows. Delivered history is preserved. */
export async function pruneNotifications(): Promise<number> {
  const sql = getSql()
  const rows = await sql<{ id: string }[]>`
    delete from notifications
     where (cancelled_at is not null and cancelled_at < now() - interval '90 days')
        or (dismissed_at is not null and dismissed_at < now() - interval '90 days')
    returning id`
  return rows.length
}

/** Full scheduler pass. */
export async function runReminderCycle(now: Date = new Date()) {
  const hearings = await generateHearingReminders(now)
  const staleCancelled = await cancelStaleNonHearingReminders()
  const delivered = await deliverDueReminders(now)
  const escalated = await escalateUnacknowledgedHearings(now)
  const tasks = await generateTaskReminders(now)
  const payments = await generatePaymentReminders(now)
  const documents = await generateDocumentReminders(now)
  const pruned = await pruneNotifications()
  return {
    created: hearings.created + tasks.created + payments.created + documents.created,
    cancelled: hearings.cancelled + tasks.cancelled + staleCancelled,
    delivered, escalated,
    skipped: hearings.skipped + documents.skipped,
    failed: hearings.failed + tasks.failed + payments.failed + documents.failed,
    pruned,
  }
}

/**
 * Reconciles reminders after a user's entitlement changes (demotion, disable,
 * delete, or loss of financial access). Cancels hearing copies they may no
 * longer receive and any payment notifications they can no longer see.
 * Historical rows are cancelled, never deleted.
 */
export async function reconcileForUser(
  userId: string,
  conn?: ReturnType<typeof getSql>,
): Promise<number> {
  // Accepts a transaction connection so callers can make the whole change atomic.
  const sql = conn ?? getSql()
  let cancelled = 0

  const hearing = await sql<{ id: string }[]>`
    update notifications n set cancelled_at = now()
     where n.recipient_user_id = ${userId}
       and n.type = 'hearing' and n.cancelled_at is null
       and not exists (select 1 from cases k where k.id = n.source_id and k.agent_id = ${userId})
       and not exists (
         select 1 from users u
          where u.id = ${userId} and u.status = 'ACTIVE'
            and u.role = any(${MANAGEMENT_ROLES as unknown as string[]}))
    returning n.id`
  cancelled += hearing.length

  // Financial access lost (or account disabled): drop payment notifications.
  const money = await sql<{ id: string }[]>`
    update notifications n set cancelled_at = now()
     where n.recipient_user_id = ${userId}
       and n.type = 'payment' and n.cancelled_at is null
       and not exists (
         select 1 from users u
          where u.id = ${userId} and u.status = 'ACTIVE'
            and u.role = any(${MONEY_ROLE_NAMES as unknown as string[]}))
    returning n.id`
  cancelled += money.length
  return cancelled
}

/** Reconciles every case currently or previously assigned to a user. */
export async function reconcileCasesForAgent(
  agentId: string,
  conn?: ReturnType<typeof getSql>,
): Promise<void> {
  const sql = conn ?? getSql()
  const cases = await sql<{ id: string }[]>`
    select distinct k.id from cases k
     where k.agent_id = ${agentId}
        or exists (select 1 from notifications n
                    where n.source_type = 'case' and n.source_id = k.id
                      and n.type = 'hearing' and n.recipient_user_id = ${agentId}
                      and n.cancelled_at is null)`
  for (const c of cases) {
    // Inside a transaction a failure must propagate so the caller can roll back;
    // outside one (cron recovery) it is also allowed to propagate to the caller.
    await reconcileCaseHearing(c.id, new Date(), conn)
  }
}

import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { getViewerScope } from '@/lib/ownership'
export const runtime = 'nodejs'

const MAX_ID = 200
const ACTIONS = ['read', 'read-all', 'dismiss', 'acknowledge'] as const

/**
 * The signed-in user's own persistent notifications.
 * Rows are selected by recipient_user_id, so one user can never read another's.
 */
export async function GET() {
  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sql = getSql()
  type NotificationRow = {
    id: string; type: string; priority: string; source_type: string; source_id: string | null
    title: string; message: string; action_url: string | null
    event_at: Date | null; scheduled_for: Date; created_at: Date
    read_at: Date | null; dismissed_at: Date | null; acknowledged_at: Date | null; escalated_at: Date | null
  }
  const items = await sql<NotificationRow[]>`
    select id, type, priority, source_type, source_id, title, message, action_url,
           event_at, scheduled_for, created_at, read_at, dismissed_at, acknowledged_at, escalated_at
      from notifications
     where recipient_user_id = ${scope.viewerId}
       and cancelled_at is null
       and dismissed_at is null
       and delivery_status = 'delivered'
     order by
       (priority = 'critical' and acknowledged_at is null) desc,
       scheduled_for desc
     limit 50`

  // Counts come from SQL over every active delivered row, not the 50 shown.
  const [counts] = await sql<{ unread: number; critical: number }[]>`
    select
      count(*) filter (where read_at is null)::int as unread,
      count(*) filter (where priority = 'critical' and acknowledged_at is null)::int as critical
      from notifications
     where recipient_user_id = ${scope.viewerId}
       and cancelled_at is null and dismissed_at is null and delivery_status = 'delivered'`
  return NextResponse.json({
    items,
    count: counts?.unread ?? 0,
    unread: counts?.unread ?? 0,
    criticalUnacknowledged: counts?.critical ?? 0,
  })
}

/**
 * Mutations. Every statement filters on recipient_user_id, so changing an id
 * in the body reaches nothing: unknown and unauthorised both return the same
 * neutral 404.
 */
export async function PATCH(req: Request) {
  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const action = b?.action
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  const sql = getSql()

  if (action === 'read-all') {
    const rows = await sql<{ id: string }[]>`
      update notifications set read_at = now()
       where recipient_user_id = ${scope.viewerId} and read_at is null
         and cancelled_at is null and dismissed_at is null and delivery_status = 'delivered'
      returning id`
    return NextResponse.json({ ok: true, updated: rows.length })
  }

  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!id || id.length > MAX_ID) return NextResponse.json({ error: 'A notification id is required.' }, { status: 400 })

  if (action === 'read') {
    const rows = await sql<{ id: string }[]>`
      update notifications set read_at = coalesce(read_at, now())
       where id = ${id} and recipient_user_id = ${scope.viewerId}
         and cancelled_at is null and dismissed_at is null and delivery_status = 'delivered'
      returning id`
    if (rows.length === 0) return NextResponse.json({ error: 'Not available' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'acknowledge') {
    const rows = await sql<{ id: string }[]>`
      update notifications
         set acknowledged_at = coalesce(acknowledged_at, now()),
             acknowledged_by = coalesce(acknowledged_by, ${scope.viewerId}),
             read_at = coalesce(read_at, now())
       where id = ${id} and recipient_user_id = ${scope.viewerId}
         and cancelled_at is null and dismissed_at is null
         and delivery_status = 'delivered'
         and type = 'hearing' and priority = 'critical'
      returning id`
    if (rows.length === 0) return NextResponse.json({ error: 'Not available' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  // dismiss: an unacknowledged critical hearing reminder may NOT be dismissed,
  // so a court date cannot be swiped away without someone taking responsibility.
  const rows = await sql<{ id: string }[]>`
    update notifications set dismissed_at = now(), read_at = coalesce(read_at, now())
     where id = ${id} and recipient_user_id = ${scope.viewerId}
       and cancelled_at is null and dismissed_at is null and delivery_status = 'delivered'
       and not (priority = 'critical' and acknowledged_at is null)
    returning id`
  if (rows.length === 0) {
    const [exists] = await sql<{ id: string; priority: string; acknowledged_at: Date | null }[]>`
      select id, priority, acknowledged_at from notifications
       where id = ${id} and recipient_user_id = ${scope.viewerId}
         and cancelled_at is null and delivery_status = 'delivered' limit 1`
    if (exists && exists.priority === 'critical' && !exists.acknowledged_at) {
      return NextResponse.json({ error: 'Acknowledge this hearing reminder before dismissing it.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

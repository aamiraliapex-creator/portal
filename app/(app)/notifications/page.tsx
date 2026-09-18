import { getViewerScope } from '@/lib/ownership'
import { getSql } from '@/lib/db'
import NotAvailable from '../NotAvailable'
import NotificationList from './NotificationList'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Every authenticated recipient sees THEIR OWN persistent notifications:
 * hearings, tasks, payments and documents. Rows are selected by
 * recipient_user_id, so no user can see another's. Financial reminders only
 * exist for roles with financial access, so no extra filtering is needed here.
 */
export default async function NotificationsPage() {
  const scope = await getViewerScope()
  if (!scope) return <NotAvailable />

  const sql = getSql()
  const rows = await sql<{
    id: string; type: string; priority: string; title: string; message: string
    action_url: string | null; event_at: Date | null; scheduled_for: Date
    read_at: Date | null; acknowledged_at: Date | null
  }[]>`
    select id, type, priority, title, message, action_url, event_at, scheduled_for,
           read_at, acknowledged_at
      from notifications
     where recipient_user_id = ${scope.viewerId}
       and cancelled_at is null and dismissed_at is null and delivery_status = 'delivered'
     order by (priority = 'critical' and acknowledged_at is null) desc, scheduled_for desc
     limit 200`

  const [counts] = await sql<{ unread: number; critical: number }[]>`
    select count(*) filter (where read_at is null)::int as unread,
           count(*) filter (where priority = 'critical' and acknowledged_at is null)::int as critical
      from notifications
     where recipient_user_id = ${scope.viewerId}
       and cancelled_at is null and dismissed_at is null and delivery_status = 'delivered'`

  const items = rows.map((r) => ({
    id: r.id, type: r.type, priority: r.priority, title: r.title, message: r.message,
    action_url: r.action_url,
    event_at: r.event_at ? new Date(r.event_at).toISOString() : null,
    scheduled_for: new Date(r.scheduled_for).toISOString(),
    read_at: r.read_at ? new Date(r.read_at).toISOString() : null,
    acknowledged_at: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
  }))

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
      <p className="text-sm text-slate-500">
        {counts?.unread ?? 0} unread
        {counts?.critical ? ` · ${counts.critical} awaiting acknowledgement` : ''}
      </p>
      <NotificationList items={items} />
    </div>
  )
}

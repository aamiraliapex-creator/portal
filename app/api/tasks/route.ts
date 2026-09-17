import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { getViewerScope } from '@/lib/ownership'
import { canAssignWorkToOthers, isTaskAssignableRole } from '@/lib/authz'
import { LIMITS, parseText, parseDate, pickEnum, firstError } from '@/lib/validation'
export const runtime = 'nodejs'

const PRIORITIES = ['Low', 'Normal', 'High'] as const
const STATUSES = ['Open', 'In Progress', 'Completed', 'Canceled'] as const

export const POST = guarded('task.create', async (req, actor) => {
  const b = await req.json().catch(() => ({}))

  const title = parseText(b.title, LIMITS.shortText, 'Title')
  const caseRef = parseText(b.caseRef, LIMITS.shortText, 'Case reference')
  const priority = pickEnum(b.priority, PRIORITIES, 'Normal', 'priority')
  const dueAt = parseDate(b.dueAt, 'Due date')

  const bad = firstError(title, caseRef, priority, dueAt)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  if (!title.value) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })

  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership is a stable user id, never free text.
  const requested = typeof b.assigneeId === 'string' && b.assigneeId.trim() !== '' ? b.assigneeId.trim() : actor.id
  if (requested !== actor.id && !canAssignWorkToOthers(actor.role)) {
    return NextResponse.json({ error: 'You can only create tasks assigned to yourself.' }, { status: 403 })
  }

  const sql = getSql()
  const [assignee] = await sql<{ id: string; name: string; role: string }[]>`
    select id, name, role from users where id = ${requested} and status = 'ACTIVE' limit 1`
  if (!assignee) return NextResponse.json({ error: 'Assignee not found or inactive.' }, { status: 400 })
  // The UI is never trusted: the target's role must itself be task-assignable.
  if (!isTaskAssignableRole(assignee.role)) {
    return NextResponse.json({ error: 'Tasks cannot be assigned to that account.' }, { status: 400 })
  }

  const [row] = await sql<{ id: string }[]>`
    insert into tasks (title, case_ref, assignee, assignee_id, due_at, priority, status)
    values (${title.value}, ${caseRef.value ?? null}, ${assignee.name}, ${assignee.id}, ${dueAt.value ?? null}, ${priority.value ?? 'Normal'}, 'Open')
    returning id`
  return NextResponse.json({ ok: true, id: row.id })
})

export const PATCH = guarded('task.update', async (req) => {
  const b = await req.json().catch(() => ({}))
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!id || id.length > LIMITS.shortText) {
    return NextResponse.json({ error: 'A task id is required.' }, { status: 400 })
  }
  const status = pickEnum(b.status, STATUSES, null, 'task status')
  if (!status.ok) return NextResponse.json({ error: status.error }, { status: 400 })
  if (!status.value) return NextResponse.json({ error: 'A valid status is required.' }, { status: 400 })

  const scope = await getViewerScope()
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sql = getSql()
  // Ownership lives INSIDE the update predicate: there is no window between a
  // permission check and an unrestricted write. An unknown id and somebody
  // else's id both match zero rows and return the same neutral 404.
  const updated = await sql<{ id: string }[]>`
    update tasks set status = ${status.value}
     where id = ${id}
       and (${scope.scoped} = false or assignee_id = ${scope.viewerId})
    returning id`
  if (updated.length === 0) return NextResponse.json({ error: 'Not available' }, { status: 404 })
  return NextResponse.json({ ok: true })
})

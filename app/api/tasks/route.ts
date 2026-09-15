import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { LIMITS, parseText, parseDate, pickEnum, firstError } from '@/lib/validation'
export const runtime = 'nodejs'

const PRIORITIES = ['Low', 'Normal', 'High'] as const
const STATUSES = ['Open', 'In Progress', 'Completed', 'Canceled'] as const

export const POST = guarded('task.create', async (req) => {
  const b = await req.json().catch(() => ({}))

  const title = parseText(b.title, LIMITS.shortText, 'Title')
  const caseRef = parseText(b.caseRef, LIMITS.shortText, 'Case reference')
  const assignee = parseText(b.assignee, LIMITS.shortText, 'Assignee')
  const priority = pickEnum(b.priority, PRIORITIES, 'Normal', 'priority')
  const dueAt = parseDate(b.dueAt, 'Due date')

  const bad = firstError(title, caseRef, assignee, priority, dueAt)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  if (!title.value) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })

  const sql = getSql()
  const [row] = await sql<{ id: string }[]>`
    insert into tasks (title, case_ref, assignee, due_at, priority, status)
    values (${title.value}, ${caseRef.value ?? null}, ${assignee.value ?? null}, ${dueAt.value ?? null}, ${priority.value ?? 'Normal'}, 'Open')
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

  const sql = getSql()
  // RETURNING tells us whether the row existed, so a bad id is a 404 rather
  // than a silent 200 that updated nothing.
  const updated = await sql<{ id: string }[]>`
    update tasks set status = ${status.value} where id = ${id} returning id`
  if (updated.length === 0) return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
  return NextResponse.json({ ok: true })
})

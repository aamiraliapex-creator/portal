import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
export const runtime = 'nodejs'

const PRIORITIES = ['Low', 'Normal', 'High'] as const
const STATUSES = ['Open', 'In Progress', 'Completed', 'Canceled'] as const

export const POST = guarded('task.create', async (req) => {
  const b = await req.json().catch(() => ({}))
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  if (!title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  const priority = (PRIORITIES as readonly string[]).includes(b.priority) ? b.priority : 'Normal'
  let dueAt: Date | null = null
  if (b.dueAt) { const d = new Date(b.dueAt); if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid due date.' }, { status: 400 }); dueAt = d }
  const sql = getSql()
  const [row] = await sql<{ id: string }[]>`
    insert into tasks (title, case_ref, assignee, due_at, priority, status)
    values (${title}, ${b.caseRef || null}, ${b.assignee || null}, ${dueAt}, ${priority}, 'Open')
    returning id`
  return NextResponse.json({ ok: true, id: row.id })
})

export const PATCH = guarded('task.update', async (req) => {
  const b = await req.json().catch(() => ({}))
  const id = typeof b.id === 'string' ? b.id : ''
  if (!id || !(STATUSES as readonly string[]).includes(b.status)) {
    return NextResponse.json({ error: 'A task id and a valid status are required.' }, { status: 400 })
  }
  const sql = getSql()
  await sql`update tasks set status = ${b.status} where id = ${id}`
  return NextResponse.json({ ok: true })
})

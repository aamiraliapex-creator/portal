import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getCurrentUser, canWriteBusinessData } from '@/lib/authz'
export const runtime = 'nodejs'

const STATUSES = ['Open', 'In Progress', 'Completed', 'Canceled'] as const

export async function POST(req: Request) {
  const actor = await getCurrentUser()
  if (!canWriteBusinessData(actor)) return NextResponse.json({ error: 'You do not have permission to create tasks.' }, { status: 403 })
  await ensureSchemaOnce()
  const b = await req.json().catch(() => ({}))
  if (!b.title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  const sql = getSql()
  const [row] = await sql<{ id: string }[]>`
    insert into tasks (title, case_ref, assignee, due_at, priority, status)
    values (${b.title}, ${b.caseRef || null}, ${b.assignee || null}, ${b.dueAt ? new Date(b.dueAt) : null}, ${b.priority || 'Normal'}, 'Open')
    returning id`
  return NextResponse.json({ ok: true, id: row.id })
}

export async function PATCH(req: Request) {
  const actor = await getCurrentUser()
  if (!canWriteBusinessData(actor)) return NextResponse.json({ error: 'You do not have permission to update tasks.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id || !b.status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  if (!(STATUSES as readonly string[]).includes(b.status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  const sql = getSql()
  await sql`update tasks set status = ${b.status} where id = ${b.id}`
  return NextResponse.json({ ok: true })
}

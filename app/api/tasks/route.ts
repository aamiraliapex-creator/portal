import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getSession } from '@/lib/session'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const s = await getSession(); if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b.id || !b.status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })
  const sql = getSql()
  await sql`update tasks set status = ${b.status} where id = ${b.id}`
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { getSession } from '@/lib/session'
export const runtime = 'nodejs'
export async function POST(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b.customerId || !b.agentId) return NextResponse.json({ error: 'Customer and agent required.' }, { status: 400 })
  const sql = getSql()
  await sql`update customers set agent_id = ${b.agentId} where id = ${b.customerId}`
  return NextResponse.json({ ok: true })
}

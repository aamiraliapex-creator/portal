import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { getCurrentUser, canWriteBusinessData } from '@/lib/authz'
export const runtime = 'nodejs'
export async function POST(req: Request) {
  const actor = await getCurrentUser()
  if (!canWriteBusinessData(actor)) return NextResponse.json({ error: 'You do not have permission to assign agents.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.customerId || !b.agentId) return NextResponse.json({ error: 'Customer and agent required.' }, { status: 400 })
  const sql = getSql()
  await sql`update customers set agent_id = ${b.agentId} where id = ${b.customerId}`
  return NextResponse.json({ ok: true })
}

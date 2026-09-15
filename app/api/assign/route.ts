import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
export const runtime = 'nodejs'

export const POST = guarded('assignment.update', async (req) => {
  const b = await req.json().catch(() => ({}))
  const customerId = typeof b.customerId === 'string' ? b.customerId : ''
  const agentId = typeof b.agentId === 'string' ? b.agentId : ''
  if (!customerId || !agentId) return NextResponse.json({ error: 'Customer and agent are required.' }, { status: 400 })
  const sql = getSql()
  const [customer] = await sql<{ id: string }[]>`select id from customers where id = ${customerId} limit 1`
  if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
  const [agent] = await sql<{ id: string }[]>`select id from users where id = ${agentId} and status = 'ACTIVE' limit 1`
  if (!agent) return NextResponse.json({ error: 'Agent not found or inactive.' }, { status: 404 })
  await sql`update customers set agent_id = ${agentId} where id = ${customerId}`
  return NextResponse.json({ ok: true })
})

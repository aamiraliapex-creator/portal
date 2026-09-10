import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getSession } from '@/lib/session'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchemaOnce()
  const b = await req.json().catch(() => ({}))
  if (!b.firstName || !b.lastName) return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 })
  const sql = getSql()
  const [row] = await sql<{ id: string }[]>`
    insert into customers (legacy_member_id, first_name, last_name, dob, email, phone, state, plan, pay_channel, cdl, license_no, dot, sub_status, next_payment, agent_id)
    values (${'M-' + Math.floor(1000 + Math.random()*9000)}, ${b.firstName}, ${b.lastName}, ${b.dob || null}, ${b.email || null}, ${b.phone || null}, ${b.state || null},
            ${b.plan || null}, ${b.payChannel || null}, ${b.cdl || 'No'}, ${b.licenseNo || null}, ${b.dot || 'No'},
            ${b.subStatus || 'Active'}, ${b.nextPayment || null}, ${b.agentId || null})
    returning id`
  return NextResponse.json({ ok: true, id: row.id })
}

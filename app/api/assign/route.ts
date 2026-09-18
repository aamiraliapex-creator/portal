import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
import { reconcileCasesForAgent, reconcileForUser } from '@/lib/reminders'
import { ASSIGNABLE_AGENT_ROLES } from '@/lib/authz'
export const runtime = 'nodejs'

export const POST = guarded('assignment.update', async (req) => {
  const b = await req.json().catch(() => ({}))
  const customerId = typeof b.customerId === 'string' ? b.customerId : ''
  const agentId = typeof b.agentId === 'string' ? b.agentId : ''
  if (!customerId || !agentId) return NextResponse.json({ error: 'Customer and agent are required.' }, { status: 400 })

  const sql = getSql()
  const [customer] = await sql<{ id: string; agent_id: string | null }[]>`
    select id, agent_id from customers where id = ${customerId} limit 1`
  if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
  const [agent] = await sql<{ id: string; role: string }[]>`
    select id, role from users where id = ${agentId} and status = 'ACTIVE' limit 1`
  if (!agent) return NextResponse.json({ error: 'Agent not found or inactive.' }, { status: 404 })
  // Only roles permitted to own customers may be assigned.
  if (!(ASSIGNABLE_AGENT_ROLES as readonly string[]).includes(agent.role)) {
    return NextResponse.json({ error: 'That user cannot be assigned as an agent.' }, { status: 400 })
  }

  // The customer update, the cases update, the former agent's cancellations and
  // the new agent's reminders all happen in ONE transaction. If reconciliation
  // fails, the assignment is rolled back completely — it is never left saved.
  try {
    await sql.begin(async (tx) => {
      const conn = tx as unknown as ReturnType<typeof getSql>
      await tx`update customers set agent_id = ${agentId} where id = ${customerId}`
      await tx`update cases set agent_id = ${agentId} where customer_id = ${customerId}`
      if (customer.agent_id && customer.agent_id !== agentId) {
        await reconcileCasesForAgent(customer.agent_id, conn)
        await reconcileForUser(customer.agent_id, conn)
      }
      await reconcileCasesForAgent(agentId, conn)
    })
  } catch (e) {
    console.error('assignment rolled back:', e instanceof Error ? e.message : 'error')
    return NextResponse.json(
      { error: 'Could not reassign and reconcile reminders. No changes were saved.' },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
})

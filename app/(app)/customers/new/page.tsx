import { getSql } from '@/lib/db'
import { ASSIGNABLE_AGENT_ROLES } from '@/lib/authz'
import CustomerForm from './CustomerForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function NewCustomerPage() {
  const sql = getSql()
  const agents = await sql<{ id: string; name: string }[]>`
    select id, name from users
    where status='ACTIVE' and role = any(${ASSIGNABLE_AGENT_ROLES as unknown as string[]})
    order by name`
  return <CustomerForm agents={agents} />
}

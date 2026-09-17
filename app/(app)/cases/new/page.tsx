import { getSql } from '@/lib/db'
import { getViewerScope, requirePageAccess } from '@/lib/ownership'
import NotAvailable from '../../NotAvailable'
import { ASSIGNABLE_AGENT_ROLES } from '@/lib/authz'
import CaseForm from './CaseForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function NewCase() {
  const scope = await requirePageAccess('case.create')
  if (!scope) return <NotAvailable />
  const scoped = scope.scoped
  const viewerId = scope.viewerId
  const sql = getSql()
  const customers = await sql<{ id: string; first_name: string; last_name: string }[]>`
    select id, first_name, last_name, legacy_member_id from customers
     where coalesce(approval_status,'ACTIVE') = 'ACTIVE' and (${scoped} = false or agent_id = ${viewerId})
     order by created_at desc limit 500`
  const agents = await sql<{ id: string; name: string }[]>`
    select id, name from users
    where status='ACTIVE'
      and role = any(${ASSIGNABLE_AGENT_ROLES as unknown as string[]})
      and (${scoped} = false or id = ${viewerId})
    order by name`
  return <CaseForm customers={customers} agents={agents} showMoney={scope.showMoney} />
}

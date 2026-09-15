import { getSql } from '@/lib/db'
import CaseForm from './CaseForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function NewCase() {
  const sql = getSql()
  const customers = await sql<{ id: string; first_name: string; last_name: string }[]>`
    select id, first_name, last_name, legacy_member_id from customers order by created_at desc limit 500`
  const agents = await sql<{ id: string; name: string }[]>`select id, name from users where status='ACTIVE' order by name`
  return <CaseForm customers={customers} agents={agents} />
}

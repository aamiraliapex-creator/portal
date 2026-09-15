import { getSql } from '@/lib/db'
import CustomerForm from './CustomerForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function NewCustomerPage() {
  const sql = getSql()
  const agents = await sql<{ id: string; name: string }[]>`select id, name from users where status='ACTIVE' order by name`
  return <CustomerForm agents={agents} />
}

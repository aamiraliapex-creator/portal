import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import CustomerForm from './CustomerForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export default async function NewCustomerPage() {
  await ensureSchemaOnce()
  const sql = getSql()
  const agents = await sql<{ id: string; name: string }[]>`select id, name from users where status='ACTIVE' order by name`
  return <CustomerForm agents={agents} />
}

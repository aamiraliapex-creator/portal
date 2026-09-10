import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import PaymentForm from './PaymentForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function NewPayment() {
  await ensureSchemaOnce()
  const sql = getSql()
  const customers = await sql<{ id: string; first_name: string; last_name: string }[]>`select id, first_name, last_name from customers order by created_at desc limit 500`
  const cases = await sql<{ id: string; customer_id: string; citation: string | null; official_no: string | null }[]>`select id, customer_id, citation, official_no from cases order by created_at desc limit 1000`
  return <PaymentForm customers={customers} cases={cases} />
}

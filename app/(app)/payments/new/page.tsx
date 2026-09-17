import { requirePageAccess } from '@/lib/ownership'
import NotAvailable from '../../NotAvailable'
import { getSql } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-server'
import { canSeeMoney } from '@/lib/authz'
import PaymentForm from './PaymentForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function NewPayment() {
  const scope = await requirePageAccess('payment.create')
  if (!scope) return <NotAvailable />
  const viewer = await getCurrentUser()
  if (!viewer || !canSeeMoney(viewer.role)) {
    return <div><h1 className="text-xl font-semibold text-slate-900">Not available</h1><p className="mt-2 text-sm text-slate-500">Financial information is limited to billing and management roles.</p></div>
  }
  const sql = getSql()
  const customers = await sql<{ id: string; first_name: string; last_name: string }[]>`select id, first_name, last_name from customers where coalesce(approval_status,'ACTIVE') = 'ACTIVE' order by created_at desc limit 500`
  const cases = await sql<{ id: string; customer_id: string; citation: string | null; official_no: string | null }[]>`select id, customer_id, citation, official_no from cases where coalesce(approval_status,'ACTIVE') = 'ACTIVE' order by created_at desc limit 1000`
  return <PaymentForm customers={customers} cases={cases} />
}

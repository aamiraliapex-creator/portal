import Link from 'next/link'
import { getSql } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-server'
import { hasPermission } from '@/lib/authz'
import ApprovalActions from './ApprovalActions'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const money = (n: number) => '$' + Number(n || 0).toLocaleString()
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

export default async function Approvals() {
  const me = await getCurrentUser()
  if (!me) return null
  if (!hasPermission(me.role, 'record.approve')) {
    return (
      <div>
        <h1 className="text-xl font-bold text-slate-900">Pending Approvals</h1>
        <div className="card mt-4 p-10 text-center text-sm text-slate-500">
          Only an Admin or Super Admin can review approvals.
        </div>
      </div>
    )
  }

  const sql = getSql()
  const customers = await sql<{ id: string; first_name: string; last_name: string; plan: string | null; created_at: string; created_by_name: string | null }[]>`
    select c.id, c.first_name, c.last_name, c.plan, c.created_at, u.name as created_by_name
    from customers c left join users u on u.id = c.created_by
    where coalesce(c.approval_status,'ACTIVE') = 'PENDING' order by c.created_at desc`
  const cases = await sql<{ id: string; citation: string | null; official_no: string | null; fee: string | null; created_at: string; first_name: string; last_name: string; created_by_name: string | null }[]>`
    select k.id, k.citation, k.official_no, k.fee, k.created_at, c.first_name, c.last_name, u.name as created_by_name
    from cases k join customers c on c.id = k.customer_id left join users u on u.id = k.created_by
    where coalesce(k.approval_status,'ACTIVE') = 'PENDING' order by k.created_at desc`

  const total = customers.length + cases.length
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Pending Approvals</h1>
          <p className="text-sm text-slate-500">Records created by a Manager or Case Agent stay inactive until you approve them.</p>
        </div>
        <span className="badge bg-brand-50 text-brand-700">{total} awaiting review</span>
      </div>

      <h2 className="mt-5 text-sm font-semibold text-slate-700">Customers ({customers.length})</h2>
      <div className="card mt-2 overflow-x-auto">
        <table className="min-w-full">
          <thead><tr><th>Customer</th><th>Plan</th><th>Submitted by</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {customers.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No customers awaiting approval.</td></tr>}
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="font-medium text-slate-800">{c.first_name} {c.last_name}</td>
                <td className="text-slate-600">{c.plan || '—'}</td>
                <td className="text-slate-600">{c.created_by_name || '—'}</td>
                <td className="text-slate-500">{d(c.created_at)}</td>
                <td><ApprovalActions kind="customer" id={c.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-slate-700">Cases ({cases.length})</h2>
      <div className="card mt-2 overflow-x-auto">
        <table className="min-w-full">
          <thead><tr><th>Citation</th><th>Customer</th><th>Fee</th><th>Submitted by</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {cases.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-500">No cases awaiting approval.</td></tr>}
            {cases.map((k) => (
              <tr key={k.id}>
                <td className="font-medium text-slate-800">{k.citation || k.official_no || '—'}</td>
                <td className="text-slate-600">{k.first_name} {k.last_name}</td>
                <td className="text-slate-600">{k.fee ? money(Number(k.fee)) : '—'}</td>
                <td className="text-slate-600">{k.created_by_name || '—'}</td>
                <td className="text-slate-500">{d(k.created_at)}</td>
                <td><ApprovalActions kind="case" id={k.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        A pending customer cannot receive cases or payments until approved. <Link href="/customers" className="text-brand-600">Back to customers</Link>
      </p>
    </div>
  )
}

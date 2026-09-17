import NotAvailable from '../../NotAvailable'
import Link from 'next/link'
import { getSql } from '@/lib/db'
import { loadCustomerCases, type CustomerCaseRow } from '@/lib/customer-cases'
import { getCurrentUser } from '@/lib/auth-server'
import { canSeeMoney, isScopedToOwnWork, hasPermission } from '@/lib/authz'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Customer = {
  id: string; first_name: string; last_name: string; email: string | null; phone: string | null;
  state: string | null; plan: string | null; sub_status: string; pay_channel: string | null;
  agent_id: string | null
}

export default async function CustomerProfile({ params: paramsInput }: { params: Promise<{ id: string }> }) {
  const params = await paramsInput
  const me = await getCurrentUser()
  const showMoney = !!me && canSeeMoney(me.role)
  const canCreateCase = !!me && hasPermission(me.role, 'case.create')
  const scoped = !!me && isScopedToOwnWork(me.role)
  const sql = getSql()
  // Ownership lives in the SQL predicate: an unauthorised id simply matches no
  // row, so missing and not-yours are literally the same code path. Financial
  // columns are only selected when the viewer may see them, so they never reach
  // props, rendered HTML or serialized server-component data.
  const [c] = await sql<Customer[]>`
    select id, legacy_member_id, first_name, last_name, dob, email, phone, state, plan,
           sub_status, cdl, license_no, dot, agent_id, joined_at, created_at,
           ${showMoney ? sql`pay_channel, next_payment` : sql`null::text as pay_channel, null::text as next_payment`}
      from customers
     where id = ${params.id}
       and (${scoped} = false or agent_id = ${me?.id ?? ''})
     limit 1`
  // A scoped viewer gets one identical neutral result whether the record is
  // missing or simply not theirs, so the page is not an existence oracle.
  if (!c) return <NotAvailable note="This record is not available." />
  const cases: CustomerCaseRow[] = await loadCustomerCases(sql, c.id, me?.id ?? '', scoped, showMoney)
  const money = (n: number) => '$' + n.toLocaleString()
  const outstanding = cases.filter((k) => Number(k.fee || 0) > Number(k.paid || 0))
  const totalDue = outstanding.reduce((a, k) => a + (Number(k.fee || 0) - Number(k.paid || 0)), 0)
  return (
    <div>
      <Link href="/customers" className="text-sm text-brand-600">← Customers</Link>
      <div className="mt-2 flex items-center justify-between">
        <div><h1 className="text-xl font-semibold text-slate-900">{c.first_name} {c.last_name}</h1><p className="text-sm text-slate-500">{c.plan || '—'} · {c.sub_status} · {c.state || '—'}</p></div>
        {canCreateCase && <Link href="/cases/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ Add case</Link>}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Email</p><p className="text-sm font-medium text-slate-800">{c.email || '—'}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Phone</p><p className="text-sm font-medium text-slate-800">{c.phone || '—'}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Pay channel</p><p className="text-sm font-medium text-slate-800">{showMoney ? (c.pay_channel || '—') : '—'}</p></div>
      </div>

      {showMoney && outstanding.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Outstanding case balances</h2>
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">Total due: {money(totalDue)}</span>
          </div>
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-2">Case</th><th className="px-4 py-2">Fee</th><th className="px-4 py-2">Paid</th><th className="px-4 py-2">Remaining</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {outstanding.map((k) => (
                <tr key={k.id}><td className="px-4 py-2">{k.citation || k.official_no}</td><td className="px-4 py-2">{money(Number(k.fee || 0))}</td><td className="px-4 py-2 text-emerald-600">{money(Number(k.paid || 0))}</td><td className="px-4 py-2 font-medium text-brand-600">{money(Number(k.fee || 0) - Number(k.paid || 0))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-6 text-sm font-semibold text-slate-700">All cases</h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-2">Citation</th><th className="px-4 py-2">Status</th>{showMoney && <><th className="px-4 py-2">Fee</th><th className="px-4 py-2">Paid</th><th className="px-4 py-2">Remaining</th></>}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {cases.length === 0 && <tr><td colSpan={showMoney ? 5 : 2} className="px-4 py-8 text-center text-slate-500">No cases yet.</td></tr>}
            {cases.map((k) => { const fee = Number(k.fee || 0), paid = Number(k.paid || 0), rem = Math.max(0, fee - paid); return (
              <tr key={k.id}><td className="px-4 py-2 font-medium text-slate-800">{k.citation || k.official_no || '—'}</td><td className="px-4 py-2 text-slate-600">{k.status}</td>{showMoney && <><td className="px-4 py-2 text-slate-600">{fee ? money(fee) : '—'}</td><td className="px-4 py-2 text-emerald-600">{money(paid)}</td><td className={'px-4 py-2 ' + (rem > 0 ? 'text-brand-600 font-medium' : 'text-slate-400')}>{fee ? money(rem) : '—'}</td></>}</tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

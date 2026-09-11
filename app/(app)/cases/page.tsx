import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Row = {
  id: string; citation: string | null; official_no: string | null; court: string | null;
  status: string; fee: string | null; paid: string | null;
  first_name: string; last_name: string; customer_id: string;
}

export default async function Cases() {
  await ensureSchemaOnce()
  const sql = getSql()
  const rows = await sql<Row[]>`
    select k.id, k.citation, k.official_no, k.court, k.status, k.fee, k.customer_id,
           c.first_name, c.last_name,
           coalesce((select sum(p.amount) from payments p where p.case_id = k.id and p.status = 'Paid'), 0) as paid
    from cases k join customers c on c.id = k.customer_id
    order by k.created_at desc limit 50`
  const money = (n: number) => '$' + n.toLocaleString()
  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-semibold text-slate-900">Cases</h1><p className="text-sm text-slate-500">Citations with the fee you charge, and what&apos;s paid vs. remaining.</p></div>
        <Link href="/cases/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ New case</Link>
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr><th className="px-4 py-3">Citation</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Fee</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Remaining</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (<tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No cases yet.</td></tr>)}
            {rows.map((k) => {
              const fee = Number(k.fee || 0), paid = Number(k.paid || 0), rem = Math.max(0, fee - paid)
              return (
                <tr key={k.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{k.citation || k.official_no || '—'}</td>
                  <td className="px-4 py-3 text-slate-600"><Link className="text-brand-600 hover:underline" href={`/customers/${k.customer_id}`}>{k.first_name} {k.last_name}</Link></td>
                  <td className="px-4 py-3 text-slate-600">{k.status}</td>
                  <td className="px-4 py-3 text-slate-600">{fee ? money(fee) : '—'}</td>
                  <td className="px-4 py-3 text-emerald-600">{money(paid)}</td>
                  <td className={'px-4 py-3 font-medium ' + (rem > 0 ? 'text-brand-600' : 'text-slate-400')}>{fee ? money(rem) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

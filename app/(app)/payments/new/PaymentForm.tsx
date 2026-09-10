'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Customer = { id: string; first_name: string; last_name: string }
type Case = { id: string; customer_id: string; citation: string | null; official_no: string | null }

export default function PaymentForm({ customers, cases }: { customers: Customer[]; cases: Case[] }) {
  const router = useRouter()
  const [form, setForm] = useState({ customerId: customers[0]?.id || '', kind: 'Membership', caseId: '', method: 'Card', amount: '', status: 'Paid' })
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const custCases = cases.filter((c) => c.customer_id === form.customerId)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    const res = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) { router.push('/payments'); router.refresh() }
    else { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save.') }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">Record payment</h1>
      {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="block text-sm font-medium text-slate-700">Customer *</label>
          <select value={form.customerId} onChange={(e) => set('customerId', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm">
            {customers.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select></div>
        <div><label className="block text-sm font-medium text-slate-700">For</label>
          <select value={form.kind} onChange={(e) => set('kind', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm"><option>Membership</option><option>Case</option></select></div>
        {form.kind === 'Case' && (
          <div><label className="block text-sm font-medium text-slate-700">Case</label>
            <select value={form.caseId} onChange={(e) => set('caseId', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm">
              <option value="">— select —</option>
              {custCases.map((k) => <option key={k.id} value={k.id}>{k.citation || k.official_no || k.id.slice(0, 6)}</option>)}
            </select></div>
        )}
        <div><label className="block text-sm font-medium text-slate-700">Method</label>
          <select value={form.method} onChange={(e) => set('method', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm"><option>Card</option><option>Zelle</option><option>ACH</option><option>Cash</option><option>Check</option></select></div>
        <div><label className="block text-sm font-medium text-slate-700">Amount ($) *</label><input type="number" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" placeholder="e.g. 250 (partial is fine)" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Status</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm"><option>Paid</option><option>Pending</option><option>Overdue</option></select></div>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={() => router.push('/payments')} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">Cancel</button>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Save payment</button>
        </div>
      </form>
      <p className="mt-3 text-xs text-slate-400">Tip: for a case, record a partial amount and the remaining balance updates automatically on the case &amp; customer.</p>
    </div>
  )
}

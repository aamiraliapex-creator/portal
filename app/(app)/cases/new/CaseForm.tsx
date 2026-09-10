'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Customer = { id: string; first_name: string; last_name: string }

export default function CaseForm({ customers, agents }: { customers: Customer[]; agents: { id: string; name: string }[] }) {
  const router = useRouter()
  const [form, setForm] = useState({
    customerId: customers[0]?.id || '', citation: '', court: '', state: '',
    status: 'New', priority: 'Normal', fee: '', fine: '', agentId: agents[0]?.id || '',
  })
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!form.customerId) { setError('Select a customer.'); return }
    const res = await fetch('/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) { router.push('/cases'); router.refresh() }
    else { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save.') }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">New case</h1>
      {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {customers.length === 0 && <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">Add a customer first.</p>}
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="block text-sm font-medium text-slate-700">Customer *</label>
          <select value={form.customerId} onChange={(e) => set('customerId', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm">
            {customers.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select></div>
        <div><label className="block text-sm font-medium text-slate-700">Citation #</label><input value={form.citation} onChange={(e) => set('citation', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Court</label><input value={form.court} onChange={(e) => set('court', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">State</label><input value={form.state} onChange={(e) => set('state', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Status</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm">
            <option>New</option><option>Action Required</option><option>Hearing Scheduled</option><option>Waiting for Court</option><option>Resolved</option><option>Dismissed</option>
          </select></div>
        <div><label className="block text-sm font-medium text-slate-700">Customer fee ($) — what you charge</label><input type="number" step="0.01" value={form.fee} onChange={(e) => set('fee', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" placeholder="e.g. 500" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Court fine ($)</label><input type="number" step="0.01" value={form.fine} onChange={(e) => set('fine', e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Assigned agent</label><select value={form.agentId} onChange={(e)=>set('agentId',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm">{agents.length===0 && <option value="">— none —</option>}{agents.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={() => router.push('/cases')} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">Cancel</button>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Create case</button>
        </div>
      </form>
    </div>
  )
}

'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
export default function CustomerForm({ agents }: { agents: { id: string; name: string }[] }) {
  const router = useRouter()
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', state: '', plan: 'Fleet Protection', payChannel: 'Card', cdl: 'No', agentId: agents[0]?.id || '' })
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  async function submit(e: React.FormEvent) { e.preventDefault(); setError('')
    const res = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) { router.push('/customers'); router.refresh() } else { const d = await res.json().catch(()=>({})); setError(d.error || 'Could not save.') } }
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">Add customer</h1>
      {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div><label className="block text-sm font-medium text-slate-700">First name *</label><input required value={form.firstName} onChange={(e)=>set('firstName',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Last name *</label><input required value={form.lastName} onChange={(e)=>set('lastName',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Email</label><input value={form.email} onChange={(e)=>set('email',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Phone</label><input value={form.phone} onChange={(e)=>set('phone',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">State</label><input value={form.state} onChange={(e)=>set('state',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Plan</label><select value={form.plan} onChange={(e)=>set('plan',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm"><option>Fleet Protection</option><option>Individual Plan</option><option>One time Team</option></select></div>
        <div><label className="block text-sm font-medium text-slate-700">Pay channel</label><select value={form.payChannel} onChange={(e)=>set('payChannel',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm"><option>Card</option><option>Zelle</option><option>ACH</option><option>Cash</option><option>Check</option></select></div>
        <div><label className="block text-sm font-medium text-slate-700">CDL driver</label><select value={form.cdl} onChange={(e)=>set('cdl',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm"><option>No</option><option>Yes</option></select></div>
        <div><label className="block text-sm font-medium text-slate-700">Assigned agent</label><select value={form.agentId} onChange={(e)=>set('agentId',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm">{agents.length===0 && <option value="">— none —</option>}{agents.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={()=>router.push('/customers')} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">Cancel</button><button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Create customer</button></div>
      </form>
    </div>
  )
}

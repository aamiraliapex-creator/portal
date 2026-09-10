'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
export default function UserForm() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', role: 'CASE_AGENT', status: 'ACTIVE', password: '' })
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) { router.push('/users'); router.refresh() } else { const d = await res.json().catch(()=>({})); setError(d.error || 'Could not save.') }
  }
  const roles = ['SUPER_ADMIN','ADMIN','MANAGER','CASE_AGENT','SALES_AGENT','BILLING','DOCUMENT_STAFF','READ_ONLY']
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">Add user</h1>
      {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div><label className="block text-sm font-medium text-slate-700">Name *</label><input required value={form.name} onChange={(e)=>set('name',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Email *</label><input required type="email" value={form.email} onChange={(e)=>set('email',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Role</label><select value={form.role} onChange={(e)=>set('role',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm">{roles.map(r=><option key={r} value={r}>{r.replace('_',' ')}</option>)}</select></div>
        <div><label className="block text-sm font-medium text-slate-700">Status</label><select value={form.status} onChange={(e)=>set('status',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm"><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></div>
        <div className="sm:col-span-2"><label className="block text-sm font-medium text-slate-700">Temporary password *</label><input required type="text" value={form.password} onChange={(e)=>set('password',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" placeholder="min 8 characters" /></div>
        <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={()=>router.push('/users')} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">Cancel</button><button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Create user</button></div>
      </form>
    </div>
  )
}

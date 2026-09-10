'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
export default function TaskForm() {
  const router = useRouter()
  const [form, setForm] = useState({ title: '', caseRef: '', assignee: '', dueAt: '', priority: 'Normal' })
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) { router.push('/tasks'); router.refresh() } else { const d = await res.json().catch(()=>({})); setError(d.error || 'Could not save.') }
  }
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">New task</h1>
      {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="block text-sm font-medium text-slate-700">Title *</label><input required value={form.title} onChange={(e)=>set('title',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Case ref</label><input value={form.caseRef} onChange={(e)=>set('caseRef',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Assignee</label><input value={form.assignee} onChange={(e)=>set('assignee',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Due date</label><input type="date" value={form.dueAt} onChange={(e)=>set('dueAt',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
        <div><label className="block text-sm font-medium text-slate-700">Priority</label><select value={form.priority} onChange={(e)=>set('priority',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm"><option>Low</option><option>Normal</option><option>High</option></select></div>
        <div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={()=>router.push('/tasks')} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">Cancel</button><button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Create task</button></div>
      </form>
    </div>
  )
}

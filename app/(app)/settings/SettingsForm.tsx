'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
export default function SettingsForm({ initial }: { initial: Record<string,string> }) {
  const router = useRouter()
  const [form, setForm] = useState({ company_name: initial.company_name || 'CL Protection USA', office_timezone: initial.office_timezone || 'America/Los_Angeles' })
  const [msg, setMsg] = useState('')
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  async function submit(e: React.FormEvent) { e.preventDefault(); setMsg('')
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setMsg(res.ok ? 'Saved.' : 'Could not save (need Manager+).'); router.refresh() }
  return (
    <form onSubmit={submit} className="mt-4 max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      {msg && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
      <div><label className="block text-sm font-medium text-slate-700">Company name</label><input value={form.company_name} onChange={(e)=>set('company_name',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
      <div><label className="block text-sm font-medium text-slate-700">Office timezone</label><input value={form.office_timezone} onChange={(e)=>set('office_timezone',e.target.value)} className="mt-1 w-full rounded-lg border-slate-300 text-sm" /></div>
      <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Save settings</button>
    </form>
  )
}

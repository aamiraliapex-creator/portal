'use client'
import { useState } from 'react'
export default function ProfileForm({ name, email, role }: { name: string; email: string; role: string }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))
  async function submit(e: React.FormEvent) { e.preventDefault(); setMsg(''); setErr('')
    if (f.next !== f.confirm) { setErr('New passwords do not match.'); return }
    const res = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: f.current, next: f.next }) })
    if (res.ok) { setMsg('Password changed.'); setF({ current: '', next: '', confirm: '' }) } else { const d = await res.json().catch(()=>({})); setErr(d.error || 'Could not change password.') } }
  return (
    <div className="max-w-xl">
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm"><span className="text-slate-500">Name:</span> <b className="text-slate-800">{name}</b></p>
        <p className="mt-1 text-sm"><span className="text-slate-500">Email:</span> {email}</p>
        <p className="mt-1 text-sm"><span className="text-slate-500">Role:</span> {role.replace('_',' ')}</p>
      </div>
      <form onSubmit={submit} className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-700">Change password</h2>
        {msg && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
        {err && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <input type="password" placeholder="Current password" value={f.current} onChange={(e)=>set('current',e.target.value)} className="w-full rounded-lg border-slate-300 text-sm" />
        <input type="password" placeholder="New password (min 8)" value={f.next} onChange={(e)=>set('next',e.target.value)} className="w-full rounded-lg border-slate-300 text-sm" />
        <input type="password" placeholder="Confirm new password" value={f.confirm} onChange={(e)=>set('confirm',e.target.value)} className="w-full rounded-lg border-slate-300 text-sm" />
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Update password</button>
      </form>
    </div>
  )
}

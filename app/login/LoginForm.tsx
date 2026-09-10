'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    setLoading(false)
    if (res.ok) { const raw = params.get('next') || '/dashboard'; router.push(raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard'); router.refresh() }
    else { const d = await res.json().catch(() => ({})); setError(d.error || 'Invalid credentials.') }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center text-center">
        <img src="/logo.png" alt="CL Protection USA" className="h-24 w-auto drop-shadow-lg" />
        <h1 className="mt-4 text-xl font-black tracking-wide text-white">CL PROTECTION USA</h1>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-500">Elite CDL Legal Defense</p>
      </div>
      <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl">
        <h2 className="text-base font-semibold text-slate-900">Sign in</h2>
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="mt-4"><label className="lbl">Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="inp" placeholder="you@clprotectionusa.com" /></div>
        <div className="mt-3"><label className="lbl">Password</label><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="inp" placeholder="••••••••" /></div>
        <button disabled={loading} className="mt-5 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-400">Authorized staff only. Activity is logged.</p>
    </div>
  )
}

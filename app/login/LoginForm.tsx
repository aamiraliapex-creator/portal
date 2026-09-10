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
    e.preventDefault()
    setError(''); setLoading(true)
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    setLoading(false)
    if (res.ok) {
      const raw = params.get('next') || '/dashboard'
      const dest = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard'
      router.push(dest); router.refresh()
    }
    else { const d = await res.json().catch(() => ({})); setError(d.error || 'Invalid credentials.') }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 text-center">
        <img src="/logo.png" alt="CL Protection USA" className="mx-auto h-20 w-auto drop-shadow-lg" />
        <h1 className="mt-4 text-lg font-black text-white">CL PROTECTION USA</h1>
        <p className="text-[11px] uppercase tracking-widest text-brand-500">Elite CDL Legal Defense</p>
      </div>
      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">Sign in</h2>
        {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <label className="mt-4 block text-sm font-medium text-slate-700">Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
          className="mt-1 w-full rounded-lg border-slate-300 text-sm" />
        <label className="mt-3 block text-sm font-medium text-slate-700">Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required
          className="mt-1 w-full rounded-lg border-slate-300 text-sm" />
        <button disabled={loading} className="mt-5 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-400">Authorized staff only. Activity is logged.</p>
    </div>
  )
}

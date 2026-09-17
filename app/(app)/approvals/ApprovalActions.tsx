'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function ApprovalActions({ kind, id }: { kind: 'customer' | 'case'; id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function decide(decision: 'APPROVE' | 'REJECT') {
    setErr(''); setBusy(true)
    let reason = ''
    if (decision === 'REJECT') {
      reason = window.prompt('Reason for rejecting (optional):') ?? ''
    }
    const res = await fetch('/api/approvals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id, decision, reason }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not save.') }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {err && <span className="text-xs text-brand-600">{err}</span>}
      <button disabled={busy} onClick={() => decide('APPROVE')} className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">Approve</button>
      <button disabled={busy} onClick={() => decide('REJECT')} className="rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">Reject</button>
    </div>
  )
}

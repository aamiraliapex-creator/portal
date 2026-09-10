'use client'
import { useRouter } from 'next/navigation'
export default function UserActions({ id, status, canDelete }: { id: string; status: string; canDelete: boolean }) {
  const router = useRouter()
  async function toggle() {
    await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }) })
    router.refresh()
  }
  async function del() {
    if (!confirm('Delete this user? This cannot be undone.')) return
    const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error || 'Could not delete.') }
    router.refresh()
  }
  return (
    <div className="flex justify-end gap-1.5">
      <button onClick={toggle} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">{status === 'ACTIVE' ? 'Disable' : 'Enable'}</button>
      {canDelete && <button onClick={del} className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100">Delete</button>}
    </div>
  )
}

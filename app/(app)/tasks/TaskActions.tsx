'use client'
import { useRouter } from 'next/navigation'
export default function TaskActions({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  async function set(newStatus: string) {
    await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: newStatus }) })
    router.refresh()
  }
  const done = status === 'Completed' || status === 'Canceled'
  return (
    <div className="flex justify-end gap-1.5">
      {!done && <button onClick={() => set('Completed')} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">Complete</button>}
      {!done && <button onClick={() => set('Canceled')} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">Cancel</button>}
      {done && <button onClick={() => set('Open')} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">Reopen</button>}
    </div>
  )
}

'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Assignee = { id: string; name: string }

export default function TaskForm({ assignees, currentUserId }: { assignees: Assignee[]; currentUserId: string }) {
  const router = useRouter()
  const [form, setForm] = useState({
    title: '', caseRef: '', dueAt: '', priority: 'Normal',
    // Ownership is a stable user id, never a typed name.
    assigneeId: assignees.find((a) => a.id === currentUserId)?.id || assignees[0]?.id || '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    const res = await fetch('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    setBusy(false)
    if (res.ok) { router.push('/tasks'); router.refresh() }
    else { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save the task.') }
  }

  const locked = assignees.length === 1

  return (
    <form onSubmit={submit} className="card max-w-2xl p-5">
      <h1 className="text-lg font-bold text-slate-900">New task</h1>
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><span className="lbl">Title</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} className="inp" required /></div>
        <div><span className="lbl">Case reference</span>
          <input value={form.caseRef} onChange={(e) => set('caseRef', e.target.value)} className="inp" /></div>
        <div><span className="lbl">Assignee</span>
          <select value={form.assigneeId} onChange={(e) => set('assigneeId', e.target.value)} className="inp" disabled={locked}>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {locked && <p className="mt-1 text-[11px] text-slate-400">You can only create tasks assigned to yourself.</p>}
        </div>
        <div><span className="lbl">Due</span>
          <input type="datetime-local" value={form.dueAt} onChange={(e) => set('dueAt', e.target.value)} className="inp" /></div>
        <div><span className="lbl">Priority</span>
          <select value={form.priority} onChange={(e) => set('priority', e.target.value)} className="inp">
            <option>Low</option><option>Normal</option><option>High</option>
          </select></div>
      </div>
      <button disabled={busy} className="btn btn-red mt-5">{busy ? 'Saving…' : 'Create task'}</button>
    </form>
  )
}

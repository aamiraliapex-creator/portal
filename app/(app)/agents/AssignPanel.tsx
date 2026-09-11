'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
export default function AssignPanel({ customers, agents }: { customers: { id: string; name: string }[]; agents: { id: string; name: string }[] }) {
  const router = useRouter()
  const [customerId, setC] = useState(customers[0]?.id || '')
  const [agentId, setA] = useState(agents[0]?.id || '')
  const [msg, setMsg] = useState('')
  async function save() {
    setMsg('')
    const res = await fetch('/api/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId, agentId }) })
    setMsg(res.ok ? 'Saved.' : 'Failed.'); if (res.ok) router.refresh()
  }
  return (
    <div className="card">
      <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Assign / reassign</h2></div>
      <div className="space-y-3 p-5 text-sm">
        {msg && <p className={'rounded px-3 py-2 text-sm ' + (msg === 'Saved.' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{msg}</p>}
        <div><span className="lbl">Customer</span><select value={customerId} onChange={(e) => setC(e.target.value)} className="inp">{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><span className="lbl">Case agent</span><select value={agentId} onChange={(e) => setA(e.target.value)} className="inp">{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <button onClick={save} className="btn btn-red w-full justify-center">Save assignment</button>
        <p className="text-[11px] text-slate-400">Assignment changes are audited &amp; notify the agent.</p>
      </div>
    </div>
  )
}

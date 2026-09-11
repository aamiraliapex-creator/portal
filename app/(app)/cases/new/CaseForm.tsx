'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { stateToTz, localInputToUtcIso } from '@/lib/timezones'
type Customer = { id: string; first_name: string; last_name: string; legacy_member_id?: string | null }
export default function CaseForm({ customers, agents }: { customers: Customer[]; agents: { id: string; name: string }[] }) {
  const router = useRouter()
  const [f, setF] = useState({ customerId: customers[0]?.id || '', citation: '', officialNo: '', ticket: '', state: '', court: '', violationDate: '', cmv: 'Unknown', cdl: 'Unknown', fine: '', fee: '', agentId: '', priority: 'Normal', status: 'New', hearingAt: '', hearingType: 'In person', prepStatus: 'Not started' })
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!f.customerId) { setError('Select a customer.'); return }
    const hearingAt = f.hearingAt ? localInputToUtcIso(f.hearingAt, stateToTz(f.state)) : ''
    const res = await fetch('/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, hearingAt }) })
    if (res.ok) { router.push('/cases'); router.refresh() } else { const d = await res.json().catch(()=>({})); setError(d.error || 'Could not save.') }
  }
  const custName = customers.find((c) => c.id === f.customerId)
  return (
    <div className="max-w-4xl">
      <button onClick={() => router.push('/cases')} className="text-sm text-brand-600">← Back</button>
      <h1 className="mt-1 text-xl font-bold text-slate-900">New case{custName ? ` for ${custName.first_name} ${custName.last_name}` : ''}</h1>
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {customers.length === 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">Add a customer first.</p>}
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="card p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-600">Customer &amp; Identifiers</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div><span className="lbl">Customer *</span><select value={f.customerId} onChange={(e)=>set('customerId',e.target.value)} className="inp">{customers.map((c)=><option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.legacy_member_id?` (${c.legacy_member_id})`:''}</option>)}</select></div>
            <div><span className="lbl">Citation number *</span><input value={f.citation} onChange={(e)=>set('citation',e.target.value)} className="inp" placeholder="e.g. T00298403" /></div>
            <div><span className="lbl">Official case #</span><input value={f.officialNo} onChange={(e)=>set('officialNo',e.target.value)} className="inp" /></div>
            <div><span className="lbl">Ticket number</span><input value={f.ticket} onChange={(e)=>set('ticket',e.target.value)} className="inp" /></div>
          </div>
        </div>
        <div className="card p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-600">Court &amp; Violation</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div><span className="lbl">State</span><input value={f.state} onChange={(e)=>set('state',e.target.value)} className="inp" /></div>
            <div><span className="lbl">Court name</span><input value={f.court} onChange={(e)=>set('court',e.target.value)} className="inp" /></div>
            <div><span className="lbl">Violation date</span><input type="date" value={f.violationDate} onChange={(e)=>set('violationDate',e.target.value)} className="inp" /></div>
            <div><span className="lbl">CMV involved</span><select value={f.cmv} onChange={(e)=>set('cmv',e.target.value)} className="inp"><option>Unknown</option><option>Yes</option><option>No</option></select></div>
            <div><span className="lbl">CDL related</span><select value={f.cdl} onChange={(e)=>set('cdl',e.target.value)} className="inp"><option>Unknown</option><option>Yes</option><option>No</option></select></div>
            <div><span className="lbl">Fine ($)</span><input type="number" step="0.01" value={f.fine} onChange={(e)=>set('fine',e.target.value)} className="inp" /></div>
            <div className="sm:col-span-3"><span className="lbl">Customer fee ($) — what you charge</span><input type="number" step="0.01" value={f.fee} onChange={(e)=>set('fee',e.target.value)} className="inp" placeholder="e.g. 500" /></div>
          </div>
        </div>
        <div className="card p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-600">Workflow</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div><span className="lbl">Assigned agent</span><select value={f.agentId} onChange={(e)=>set('agentId',e.target.value)} className="inp"><option value="">— unassigned —</option>{agents.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><span className="lbl">Priority</span><select value={f.priority} onChange={(e)=>set('priority',e.target.value)} className="inp"><option>Low</option><option>Normal</option><option>High</option></select></div>
            <div><span className="lbl">Status</span><select value={f.status} onChange={(e)=>set('status',e.target.value)} className="inp"><option>New</option><option>Action Required</option><option>Hearing Scheduled</option><option>Waiting for Court</option><option>Resolved</option><option>Dismissed</option></select></div>
          </div>
        </div>
        <div className="card p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-600">Hearing (optional)</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div><span className="lbl">Date &amp; time (court-local)</span><input type="datetime-local" value={f.hearingAt} onChange={(e)=>set('hearingAt',e.target.value)} className="inp" /></div>
            <div><span className="lbl">Type</span><select value={f.hearingType} onChange={(e)=>set('hearingType',e.target.value)} className="inp"><option>In person</option><option>Zoom</option><option>Phone</option></select></div>
            <div><span className="lbl">Prep status</span><select value={f.prepStatus} onChange={(e)=>set('prepStatus',e.target.value)} className="inp"><option>Not started</option><option>In progress</option><option>Ready</option></select></div>
          </div>
          <p className="mt-2 text-xs text-slate-400">Time zone is inferred from the state entered above. You can adjust this later from the Hearings page.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={()=>router.push('/cases')} className="btn btn-ghost">Cancel</button>
          <button className="btn btn-red">Create case</button>
        </div>
      </form>
    </div>
  )
}

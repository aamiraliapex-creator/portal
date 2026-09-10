'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
export default function CustomerForm({ agents }: { agents: { id: string; name: string }[] }) {
  const router = useRouter()
  const [f, setF] = useState({ firstName: '', lastName: '', dob: '', email: '', phone: '', state: '', plan: 'Fleet Protection', agentId: agents[0]?.id || '', subStatus: 'Active', cdl: 'No', licenseNo: '', dot: 'No', payChannel: 'Card', nextPayment: '' })
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    const res = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
    if (res.ok) { router.push('/customers'); router.refresh() } else { const d = await res.json().catch(()=>({})); setError(d.error || 'Could not save.') }
  }
  return (
    <div className="max-w-4xl">
      <button onClick={() => router.push('/customers')} className="text-sm text-brand-600">← Back</button>
      <h1 className="mt-1 text-xl font-bold text-slate-900">Add customer</h1>
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="card p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-600">Identity &amp; Contact</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div><span className="lbl">First name *</span><input required value={f.firstName} onChange={(e)=>set('firstName',e.target.value)} className="inp" /></div>
            <div><span className="lbl">Last name *</span><input required value={f.lastName} onChange={(e)=>set('lastName',e.target.value)} className="inp" /></div>
            <div><span className="lbl">Date of birth</span><input type="date" value={f.dob} onChange={(e)=>set('dob',e.target.value)} className="inp" /></div>
            <div><span className="lbl">Email</span><input type="email" value={f.email} onChange={(e)=>set('email',e.target.value)} className="inp" placeholder="name@email.com" /></div>
            <div><span className="lbl">Phone</span><input value={f.phone} onChange={(e)=>set('phone',e.target.value)} className="inp" /></div>
            <div><span className="lbl">State</span><input value={f.state} onChange={(e)=>set('state',e.target.value)} className="inp" placeholder="e.g. CA" /></div>
          </div>
        </div>
        <div className="card p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-600">Membership &amp; Driver</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div><span className="lbl">Plan</span><select value={f.plan} onChange={(e)=>set('plan',e.target.value)} className="inp"><option>Fleet Protection ($39.99)</option><option>Individual Plan ($49.99)</option><option>One time Team</option></select></div>
            <div><span className="lbl">Assigned agent</span><select value={f.agentId} onChange={(e)=>set('agentId',e.target.value)} className="inp">{agents.length===0 && <option value="">— none —</option>}{agents.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><span className="lbl">Subscription</span><select value={f.subStatus} onChange={(e)=>set('subStatus',e.target.value)} className="inp"><option>Active</option><option>Past due</option><option>Cancelled</option><option>None</option></select></div>
            <div><span className="lbl">CDL</span><select value={f.cdl} onChange={(e)=>set('cdl',e.target.value)} className="inp"><option>No</option><option>Yes</option></select></div>
            <div><span className="lbl">Driver license #</span><input value={f.licenseNo} onChange={(e)=>set('licenseNo',e.target.value)} className="inp" placeholder="stored securely" /></div>
            <div><span className="lbl">DOT number</span><select value={f.dot} onChange={(e)=>set('dot',e.target.value)} className="inp"><option>No</option><option>Yes</option></select></div>
            <div><span className="lbl">Pay channel</span><select value={f.payChannel} onChange={(e)=>set('payChannel',e.target.value)} className="inp"><option>Card</option><option>Zelle</option><option>ACH</option><option>Cash</option><option>Check</option></select></div>
            <div><span className="lbl">Next payment date</span><input type="date" value={f.nextPayment} onChange={(e)=>set('nextPayment',e.target.value)} className="inp" placeholder="Auto (plan + join date)" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={()=>router.push('/customers')} className="btn btn-ghost">Cancel</button>
          <button className="btn btn-red">Create customer</button>
        </div>
      </form>
    </div>
  )
}

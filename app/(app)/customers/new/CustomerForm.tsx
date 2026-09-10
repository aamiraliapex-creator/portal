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
  const F = ({ label, k, type = 'text', ph = '' }: { label: string; k: keyof typeof f; type?: string; ph?: string }) => (
    <div><span className="lbl">{label}</span><input type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} className="inp" placeholder={ph} /></div>
  )
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-slate-900">Add customer</h1>
      <p className="text-sm text-slate-500">Create a master profile. Cases &amp; payments attach to this customer.</p>
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <form onSubmit={submit} className="card mt-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><span className="lbl">First name *</span><input required value={f.firstName} onChange={(e)=>set('firstName',e.target.value)} className="inp" /></div>
          <div><span className="lbl">Last name *</span><input required value={f.lastName} onChange={(e)=>set('lastName',e.target.value)} className="inp" /></div>
          <F label="Date of birth" k="dob" type="date" />
          <F label="Email" k="email" type="email" ph="name@email.com" />
          <F label="Phone" k="phone" ph="(555) 555-5555" />
          <F label="State" k="state" ph="CA" />
          <div><span className="lbl">Plan</span><select value={f.plan} onChange={(e)=>set('plan',e.target.value)} className="inp"><option>Fleet Protection</option><option>Individual Plan</option><option>One time Team</option></select></div>
          <div><span className="lbl">Assigned agent</span><select value={f.agentId} onChange={(e)=>set('agentId',e.target.value)} className="inp">{agents.length===0 && <option value="">— none —</option>}{agents.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><span className="lbl">Subscription</span><select value={f.subStatus} onChange={(e)=>set('subStatus',e.target.value)} className="inp"><option>Active</option><option>Past due</option><option>Cancelled</option><option>None</option></select></div>
          <div><span className="lbl">CDL</span><select value={f.cdl} onChange={(e)=>set('cdl',e.target.value)} className="inp"><option>No</option><option>Yes</option></select></div>
          <F label="Driver license #" k="licenseNo" />
          <div><span className="lbl">DOT number</span><select value={f.dot} onChange={(e)=>set('dot',e.target.value)} className="inp"><option>No</option><option>Yes</option></select></div>
          <div><span className="lbl">Pay channel</span><select value={f.payChannel} onChange={(e)=>set('payChannel',e.target.value)} className="inp"><option>Card</option><option>Zelle</option><option>ACH</option><option>Cash</option><option>Check</option></select></div>
          <F label="Next payment date" k="nextPayment" type="date" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={()=>router.push('/customers')} className="btn btn-ghost">Cancel</button>
          <button className="btn btn-red">Create customer</button>
        </div>
      </form>
    </div>
  )
}

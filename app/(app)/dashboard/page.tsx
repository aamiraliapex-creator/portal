import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { nextHoliday, holidayToday, fmtHoliday, daysUntil } from '@/lib/holidays'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const money = (n: number) => '$' + Number(n || 0).toLocaleString()

function Donut({ segments, center, sub }: { segments: { v: number; c: string }[]; center: string; sub?: string }) {
  const total = segments.reduce((a, s) => a + s.v, 0) || 1
  let acc = 0
  return (
    <div className="relative h-32 w-32">
      <svg viewBox="0 0 36 36" className="h-32 w-32 -rotate-90">
        <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#eef0f2" strokeWidth="3.5" />
        {segments.map((s, i) => { const pct = (s.v / total) * 100; const el = <circle key={i} cx="18" cy="18" r="15.9155" fill="none" stroke={s.c} strokeWidth="3.5" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-acc} />; acc += pct; return el })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-extrabold text-slate-900">{center}</span>{sub && <span className="text-[10px] text-slate-500">{sub}</span>}</div>
    </div>
  )
}

export default async function Dashboard() {
  await ensureSchemaOnce()
  const sql = getSql()
  const [c] = await sql<{ total: number; active: number; newmonth: number }[]>`select count(*)::int total, count(*) filter (where sub_status='Active')::int active, count(*) filter (where coalesce(joined_at,created_at) >= date_trunc('month', now()))::int newmonth from customers`
  const [k] = await sql<{ total: number; open: number; needaction: number; active: number; waiting: number; resolved: number }[]>`select count(*)::int total, count(*) filter (where status not in ('Resolved','Dismissed'))::int open, count(*) filter (where status='Action Required')::int needaction, count(*) filter (where status in ('New','Action Required','Hearing Scheduled','Motion Prep','Under Review'))::int active, count(*) filter (where status='Waiting for Court')::int waiting, count(*) filter (where status in ('Resolved','Dismissed'))::int resolved from cases`
  const [t] = await sql<{ overdue: number }[]>`select count(*) filter (where status in ('Open','In Progress') and due_at < now())::int overdue from tasks`
  const [p] = await sql<{ collected: string; outstanding: string; overdue_inv: number }[]>`select coalesce(sum(amount) filter (where status='Paid'),0) collected, coalesce(sum(amount) filter (where status in ('Pending','Overdue')),0) outstanding, count(*) filter (where status in ('Pending','Overdue'))::int overdue_inv from payments`
  const [h] = await sql<{ week: number; today: number }[]>`select count(*) filter (where next_action_at >= now() and next_action_at < now() + interval '7 days')::int week, count(*) filter (where next_action_at::date = now()::date)::int today from cases`
  const methods = await sql<{ method: string; total: string }[]>`select method, sum(amount) total from payments where status='Paid' group by method order by total desc`
  const topAgents = await sql<{ name: string; n: number }[]>`select u.name, count(cu.*)::int n from users u left join customers cu on cu.agent_id=u.id where u.status='ACTIVE' group by u.name order by n desc limit 5`
  const recent = await sql<{ id: string; first_name: string; last_name: string; legacy_member_id: string | null; plan: string | null; sub_status: string; agent_name: string | null; pay_channel: string | null; cases: number; joined: string }[]>`select cu.id, cu.first_name, cu.last_name, cu.legacy_member_id, cu.plan, cu.sub_status, cu.pay_channel, coalesce(cu.joined_at,cu.created_at) joined, u.name agent_name, (select count(*) from cases k where k.customer_id=cu.id)::int cases from customers cu left join users u on u.id=cu.agent_id order by coalesce(cu.joined_at,cu.created_at) desc limit 5`
  const owing = await sql<{ label: string; sub: string; agent: string | null; days: number }[]>`
    select ('$'||(k.fee - coalesce((select sum(pp.amount) from payments pp where pp.case_id=k.id and pp.status='Paid'),0))||' unpaid · '||coalesce(k.citation,k.official_no,'case')) label,
      (cu.first_name||' '||cu.last_name) sub, u.name agent,
      greatest(0, extract(day from now()-coalesce(k.fee_since,k.created_at))::int) days
    from cases k join customers cu on cu.id=k.customer_id left join users u on u.id=k.agent_id
    where k.fee is not null and k.fee > coalesce((select sum(pp.amount) from payments pp where pp.case_id=k.id and pp.status='Paid'),0)
    order by days desc limit 5`

  const maxM = Math.max(1, ...methods.map((m) => Number(m.total)))
  const th = holidayToday(); const nx = nextHoliday()
  const subBadge = (s: string) => s === 'Active' ? 'text-emerald-600' : s === 'Cancelled' ? 'text-rose-600' : s === 'Past due' ? 'text-amber-600' : 'text-slate-500'
  const d = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const kpis: [string, string | number, string, string][] = [
    ['Total Customers', c.total, 'text-slate-900', `▲ ${c.newmonth} this month`],
    ['Active Members', c.active, 'text-emerald-600', `${c.total ? Math.round((c.active / c.total) * 100) : 0}% of base`],
    ['Open Cases', k.open, 'text-brand-600', `${k.needaction} need action`],
    ['Hearings / Week', h.week, 'text-slate-900', `${h.today} today`],
    ['Overdue Tasks', t.overdue, 'text-brand-600', 'never hidden'],
    ['Outstanding $', money(Number(p.outstanding)), 'text-brand-600', `${p.overdue_inv} overdue`],
  ]
  return (
    <div>
      {/* Holiday bar */}
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm">
        <span>📅</span>
        <p className="flex-1 text-slate-600">{th ? <><b className="text-emerald-700">Today is {th.n}</b> — a U.S. federal holiday</> : nx ? <>Next U.S. holiday: <b className="text-brand-700">{nx.n}</b> — {fmtHoliday(nx.d)} <span className="text-slate-400">(in {daysUntil(nx.obs || nx.d)} days)</span></> : null}</p>
        <Link href="/holidays" className="chip">All holidays</Link>
      </div>
      {/* Announcement */}
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white"><span>📢</span><p className="flex-1"><b>Announcement:</b> Portal timezone shown for both US (California) and Pakistan. Managers can edit announcements in Settings.</p></div>

      <h1 className="text-xl font-bold text-slate-900">Operations Dashboard</h1>
      <p className="text-sm text-slate-500">Live database figures.</p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([l, v, col, sub]) => <div key={l} className="card p-4"><p className="text-xs text-slate-500">{l}</p><p className={'mt-1 text-2xl font-extrabold ' + col}>{v}</p><p className="mt-0.5 text-[11px] text-slate-400">{sub}</p></div>)}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-700">Payments &amp; Billing</h2><Link href="/payments" className="text-xs font-semibold text-brand-600">View all →</Link></div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
            <div><p className="text-xs text-slate-500">Collected</p><p className="text-lg font-bold text-emerald-600">{money(Number(p.collected))}</p></div>
            <div><p className="text-xs text-slate-500">Outstanding</p><p className="text-lg font-bold text-brand-600">{money(Number(p.outstanding))}</p></div>
            <div><p className="text-xs text-slate-500">Overdue inv.</p><p className="text-lg font-bold text-slate-900">{p.overdue_inv}</p></div>
            <div><p className="text-xs text-slate-500">Methods</p><p className="text-lg font-bold text-slate-900">{methods.length}</p></div>
          </div>
          <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">By payment method</p>
          <div className="space-y-2 text-sm">
            {methods.length === 0 && <p className="text-slate-500">No payments recorded yet.</p>}
            {methods.map((m) => <div key={m.method} className="flex items-center gap-3"><span className="w-14 text-slate-600">{m.method}</span><div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: Math.round((Number(m.total) / maxM) * 100) + '%' }} /></div><span className="w-20 text-right text-slate-500">{money(Number(m.total))}</span></div>)}
          </div>
        </div>
        <div className="card p-5 flex flex-col items-center justify-center">
          <h2 className="mb-2 self-start text-sm font-semibold text-slate-700">Monthly Target</h2>
          <Donut segments={[{ v: c.active, c: '#d4a72c' }]} center={String(c.active)} sub="active" />
          <p className="mt-2 text-xs text-slate-500">Active members vs. base</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Management Action Center</h2><span className="text-xs text-brand-600">{owing.length} items</span></div>
          <div className="divide-y divide-slate-50">
            {owing.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing needs attention right now.</p>}
            {owing.map((o, i) => <div key={i} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="badge bg-brand-50 text-brand-700"><span className="dot" />{o.days > 20 ? 'FEE OVERDUE' : 'DUE'}</span><div className="flex-1"><p className="font-medium text-slate-800">{o.label}</p><p className="text-slate-500">{o.sub} · {o.days} days</p></div><span className="text-slate-400">{o.agent || ''}</span></div>)}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Case Status</h2>
          <div className="flex items-center gap-4">
            <Donut segments={[{ v: k.active, c: '#c62222' }, { v: k.waiting, c: '#d4a72c' }, { v: k.resolved, c: '#059669' }]} center={String(k.total)} sub="cases" />
            <div className="space-y-1 text-xs">
              <p className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-brand-600" />Active {k.total ? Math.round((k.active / k.total) * 100) : 0}%</p>
              <p className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-gold-500" />Waiting court {k.total ? Math.round((k.waiting / k.total) * 100) : 0}%</p>
              <p className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-600" />Resolved {k.total ? Math.round((k.resolved / k.total) * 100) : 0}%</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Recent Members</h2><Link href="/customers" className="text-xs font-semibold text-brand-600">Open customers →</Link></div>
        <div className="overflow-x-auto"><table className="min-w-full"><thead><tr><th>Member</th><th>Joined</th><th>Plan</th><th>Agent</th><th>Pay</th><th>Subscription</th><th>Cases</th></tr></thead><tbody>
          {recent.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No customers yet.</td></tr>}
          {recent.map((r) => <tr key={r.id} className="rowlink"><td><Link className="font-medium text-brand-600" href={`/customers/${r.id}`}>{r.first_name} {r.last_name}</Link><div className="text-xs text-slate-400">{r.legacy_member_id || ''}</div></td><td>{d(r.joined)}</td><td>{r.plan || '—'}</td><td>{r.agent_name || '—'}</td><td>{r.pay_channel || '—'}</td><td className={subBadge(r.sub_status)}>● {r.sub_status}</td><td>{r.cases}</td></tr>)}
        </tbody></table></div>
      </div>

      <div className="card mt-4">
        <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Top Sales Agents (by customers)</h2></div>
        <div className="divide-y divide-slate-50 p-2">
          {topAgents.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">No agents yet.</p>}
          {topAgents.map((a, i) => <div key={a.name} className="flex items-center gap-3 px-3 py-2"><span className={'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ' + (i === 0 ? 'bg-gold-500 text-ink-950' : i === 1 ? 'bg-slate-300 text-white' : 'bg-brand-700 text-white')}>{i + 1}</span><div className="flex-1"><p className="text-sm font-medium text-slate-800">{a.name}</p><p className="text-xs text-slate-500">{a.n} customers</p></div></div>)}
        </div>
      </div>
    </div>
  )
}

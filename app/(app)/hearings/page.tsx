import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { stateToTz, formatInTz, formatTimeInTz, OFFICE_TZ } from '@/lib/timezones'
import SchedulePicker from './SchedulePicker'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Row = {
  id: string; citation: string | null; official_no: string | null; court: string | null; state: string | null;
  status: string; hearing_at: string | null; hearing_tz: string | null; hearing_type: string; prep_status: string;
  next_action: string | null; next_action_at: string | null;
  customer_id: string; first_name: string; last_name: string
}

const statusBadge = (s: string) => {
  const m: Record<string, string> = { 'Hearing Scheduled': 'bg-sky-50 text-sky-700', 'Waiting for Court': 'bg-indigo-50 text-indigo-700', 'Resolved': 'bg-emerald-50 text-emerald-700', 'Dismissed': 'bg-emerald-50 text-emerald-700' }
  return m[s] || 'bg-slate-100 text-slate-600'
}
const statusDot = (s: string) => (s.includes('Hearing') ? 'text-sky-600' : s.includes('Waiting') ? 'text-indigo-600' : 'text-emerald-600')
const typeBadge = (t: string) => {
  const m: Record<string, string> = { Zoom: 'bg-sky-50 text-sky-700', 'In person': 'bg-slate-100 text-slate-600', Phone: 'bg-violet-50 text-violet-700' }
  return m[t] || 'bg-slate-100 text-slate-600'
}
const prepBadge = (p: string) => {
  const m: Record<string, string> = { 'Not started': 'bg-slate-100 text-slate-500', 'In progress': 'bg-amber-50 text-amber-700', 'Ready': 'bg-emerald-50 text-emerald-700' }
  return m[p] || 'bg-slate-100 text-slate-500'
}

export default async function Hearings() {
  await ensureSchemaOnce()
  const sql = getSql()
  const rows = await sql<Row[]>`
    select k.id, k.citation, k.official_no, k.court, k.state, k.status, k.hearing_at, k.hearing_tz, k.hearing_type, k.prep_status,
           k.next_action, k.next_action_at, k.customer_id, c.first_name, c.last_name
    from cases k join customers c on c.id=k.customer_id
    where k.hearing_at is not null or k.status in ('Hearing Scheduled','Waiting for Court')
    order by coalesce(k.hearing_at, k.next_action_at) asc nulls last limit 200`

  const unscheduled = await sql<{ id: string; citation: string | null; official_no: string | null; first_name: string; last_name: string }[]>`
    select k.id, k.citation, k.official_no, c.first_name, c.last_name
    from cases k join customers c on c.id = k.customer_id
    where k.hearing_at is null and k.status not in ('Resolved','Dismissed')
    order by k.created_at desc limit 100`
  const options = unscheduled.map((k) => ({ id: k.id, label: `${k.first_name} ${k.last_name} - ${k.citation || k.official_no || 'no citation'}` }))

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Hearings</h1>
          <p className="text-sm text-slate-500">Court-local time shown, with your office time alongside.</p>
        </div>
      </div>

      <div className="mt-4"><SchedulePicker options={options} /></div>

      <div className="mt-3 card overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th>Date (court local)</th><th>Customer</th><th>Case</th><th>Court</th><th>Type</th><th>Prep</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-500">No scheduled hearings.</td></tr>}
            {rows.map((k) => {
              const tz = k.hearing_tz || stateToTz(k.state)
              const when = k.hearing_at
              return (
                <tr key={k.id} className="rowlink">
                  <td>
                    {when ? (
                      <>
                        <div className="font-semibold text-slate-800">{formatInTz(when, tz)}</div>
                        {tz !== OFFICE_TZ && <div className="text-xs text-slate-400">{formatTimeInTz(when, OFFICE_TZ)} office</div>}
                      </>
                    ) : (
                      <span className="text-slate-500">{k.next_action || '-'}{k.next_action_at ? ' - ' + new Date(k.next_action_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                    )}
                  </td>
                  <td className="text-slate-700"><Link className="hover:underline" href={`/customers/${k.customer_id}`}>{k.first_name} {k.last_name}</Link></td>
                  <td className="text-slate-600">{k.citation || k.official_no || '—'}</td>
                  <td className="text-slate-600">{k.court || '—'}</td>
                  <td><span className={'badge ' + typeBadge(k.hearing_type)}>{k.hearing_type}</span></td>
                  <td><span className={'badge ' + prepBadge(k.prep_status)}>{k.prep_status}</span></td>
                  <td><span className={'badge ' + statusBadge(k.status)}><span className={'dot ' + statusDot(k.status)} />{k.status}</span></td>
                  <td><Link href={`/hearings/${k.id}`} className="text-xs font-semibold text-brand-600 hover:underline">Edit</Link></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

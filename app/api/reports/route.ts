import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getCurrentUser } from '@/lib/authz'
import { stateToTz, formatInTz } from '@/lib/timezones'
import { toCsv } from '@/lib/csv'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const actor = await getCurrentUser()
  if (!actor) return new Response('Unauthorized', { status: 401 })
  await ensureSchemaOnce()
  const sql = getSql()
  const { searchParams } = new URL(req.url)
  const r = searchParams.get('r') || 'status'
  let head: string[] = []; let body: (string | number)[][] = []
  if (r === 'status') { head = ['Status', 'Cases']; const d = await sql<{ status: string; n: number }[]>`select status, count(*)::int n from cases group by status order by n desc`; body = d.map((x) => [x.status, x.n]) }
  else if (r === 'agent') { head = ['Agent', 'Cases']; const d = await sql<{ name: string; n: number }[]>`select coalesce(u.name,'Unassigned') name, count(k.*)::int n from cases k left join users u on u.id=k.agent_id group by 1 order by n desc`; body = d.map((x) => [x.name, x.n]) }
  else if (r === 'custagent') { head = ['Agent', 'Customers']; const d = await sql<{ name: string; n: number }[]>`select coalesce(u.name,'Unassigned') name, count(c.*)::int n from customers c left join users u on u.id=c.agent_id group by 1 order by n desc`; body = d.map((x) => [x.name, x.n]) }
  else if (r === 'method') { head = ['Method', 'Total Paid']; const d = await sql<{ method: string; total: string }[]>`select method, sum(amount) total from payments where status='Paid' group by method order by total desc`; body = d.map((x) => [x.method, Number(x.total)]) }
  else if (r === 'outstanding') { head = ['Invoice', 'Customer', 'Amount', 'Status']; const d = await sql<{ invoice: string | null; first_name: string; last_name: string; amount: string; status: string }[]>`select p.invoice, c.first_name, c.last_name, p.amount, p.status from payments p join customers c on c.id=p.customer_id where p.status in ('Pending','Overdue') order by p.paid_at desc`; body = d.map((x) => [x.invoice || '', x.first_name + ' ' + x.last_name, Number(x.amount), x.status]) }
  else if (r === 'newcust') { head = ['Month', 'New Customers']; const d = await sql<{ m: string; n: number }[]>`select to_char(date_trunc('month', coalesce(joined_at,created_at)),'Mon YYYY') m, count(*)::int n from customers group by 1 order by min(coalesce(joined_at,created_at))`; body = d.map((x) => [x.m, x.n]) }
  else if (r === 'hearings') { head = ['Case', 'Customer', 'Court', 'Hearing (court-local)', 'Type', 'Prep', 'Status']; const d = await sql<{ citation: string | null; official_no: string | null; first_name: string; last_name: string; court: string | null; state: string | null; hearing_at: string | null; hearing_tz: string | null; hearing_type: string; prep_status: string; status: string; next_action: string | null; next_action_at: string | null }[]>`select k.citation, k.official_no, c.first_name, c.last_name, k.court, k.state, k.hearing_at, k.hearing_tz, k.hearing_type, k.prep_status, k.status, k.next_action, k.next_action_at from cases k join customers c on c.id=k.customer_id where k.hearing_at is not null or k.status in ('Hearing Scheduled','Waiting for Court') order by coalesce(k.hearing_at, k.next_action_at) asc nulls last`; body = d.map((x) => { const tz = x.hearing_tz || stateToTz(x.state); const when = x.hearing_at ? formatInTz(x.hearing_at, tz) : (x.next_action || ''); return [x.citation || x.official_no || '', x.first_name + ' ' + x.last_name, x.court || '', when, x.hearing_type || '', x.prep_status || '', x.status] }) }
  const out = toCsv([head, ...body])
  // Always genuine CSV with a matching extension/mime-type. We previously served this same
  // CSV text as "application/vnd.ms-excel" with a ".xls" extension when format=xlsx was
  // requested, which mislabels plain CSV as a native Excel binary workbook — misleading,
  // and can trip strict-format checks in some Excel versions. Generating a real .xlsx
  // binary is possible but needs a new charting/zip dependency; until that's worth adding,
  // we offer CSV only (which Excel opens natively) rather than a fake Excel file.
  return new Response(out, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="report-${r}.csv"` } })
}

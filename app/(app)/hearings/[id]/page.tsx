import Link from 'next/link'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import HearingForm from './HearingForm'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CaseRow = {
  id: string; citation: string | null; official_no: string | null; court: string | null; state: string | null;
  status: string; hearing_at: string | null; hearing_tz: string | null; hearing_type: string; prep_status: string;
  customer_id: string; first_name: string; last_name: string
}

export default async function EditHearing({ params }: { params: { id: string } }) {
  await ensureSchemaOnce()
  const sql = getSql()
  const [k] = await sql<CaseRow[]>`
    select k.id, k.citation, k.official_no, k.court, k.state, k.status, k.hearing_at, k.hearing_tz, k.hearing_type, k.prep_status,
           k.customer_id, c.first_name, c.last_name
    from cases k join customers c on c.id = k.customer_id
    where k.id = ${params.id} limit 1`
  if (!k) return <div><h1 className="text-xl font-semibold">Case not found</h1><Link className="text-brand-600" href="/hearings">← Back to hearings</Link></div>
  return <HearingForm caseRow={k} />
}

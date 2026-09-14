import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSchemaOnce } from '@/lib/schema'
import { getCurrentUser, canManageSettings } from '@/lib/authz'
export const runtime = 'nodejs'
export async function POST(req: Request) {
  const actor = await getCurrentUser()
  if (!canManageSettings(actor)) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  await ensureSchemaOnce()
  const b = await req.json().catch(() => ({}))
  const sql = getSql()
  for (const [k, v] of Object.entries(b)) {
    await sql`insert into settings (key, value, updated_at) values (${k}, ${String(v)}, now()) on conflict (key) do update set value = ${String(v)}, updated_at = now()`
  }
  return NextResponse.json({ ok: true })
}

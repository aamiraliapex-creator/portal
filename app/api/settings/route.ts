import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { guarded } from '@/lib/auth-server'
export const runtime = 'nodejs'

/** Only known settings keys may be written. */
const ALLOWED_KEYS = ['company_name', 'office_timezone', 'announcement'] as const
const MAX_VALUE_LENGTH = 2000

export const POST = guarded('settings.update', async (req) => {
  const b = await req.json().catch(() => ({}))
  if (typeof b !== 'object' || b === null) return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  const entries = Object.entries(b as Record<string, unknown>)
    .filter(([k]) => (ALLOWED_KEYS as readonly string[]).includes(k))
  if (entries.length === 0) return NextResponse.json({ error: 'No recognised settings supplied.' }, { status: 400 })
  const sql = getSql()
  for (const [k, v] of entries) {
    const value = String(v ?? '').slice(0, MAX_VALUE_LENGTH)
    await sql`insert into settings (key, value, updated_at) values (${k}, ${value}, now())
              on conflict (key) do update set value = ${value}, updated_at = now()`
  }
  return NextResponse.json({ ok: true })
})

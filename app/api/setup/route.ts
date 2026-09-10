import { NextResponse } from 'next/server'
import { ensureSchema } from '@/lib/schema'
export const runtime = 'nodejs'

export async function GET() {
  try {
    await ensureSchema()
    return NextResponse.json({ ok: true, message: 'Database ready. Tables created and Super Admin ensured. You can log in now.' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireCronSecret, timingSafeEqual, ConfigError } from '@/lib/env'
import { runReminderCycle } from '@/lib/reminders'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Scheduled reminder pass.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/reminders
 *
 * Authenticated ONLY by the bearer secret: a normal portal session never
 * authorises this endpoint. Fails closed when CRON_SECRET is missing or short.
 * The response carries safe counts only — never customer or hearing details —
 * and the secret is never logged or echoed.
 */
export async function GET(req: Request) {
  let expected: string
  try {
    expected = requireCronSecret()
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error('cron rejected: scheduler secret is not configured')
      return NextResponse.json({ error: 'Scheduler is not configured.' }, { status: 503 })
    }
    throw e
  }

  const header = req.headers.get('authorization') || ''
  const prefix = 'Bearer '
  const provided = header.startsWith(prefix) ? header.slice(prefix.length) : ''
  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await runReminderCycle(new Date())
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    // Log a message only: never the secret, never customer data.
    console.error('reminder cycle failed:', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ ok: false, error: 'Reminder cycle failed.' }, { status: 500 })
  }
}

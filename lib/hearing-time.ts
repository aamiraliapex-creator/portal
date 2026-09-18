import { stateToTzStrict } from './timezones'

/** The four court-hearing reminder intervals, in minutes before the hearing. */
export const HEARING_INTERVALS = [
  { key: '4d', minutes: 4 * 24 * 60, critical: false, label: '4 days' },
  { key: '3d', minutes: 3 * 24 * 60, critical: false, label: '3 days' },
  { key: '24h', minutes: 24 * 60, critical: true, label: '24 hours' },
  { key: '2h', minutes: 2 * 60, critical: true, label: '2 hours' },
] as const
export type HearingInterval = (typeof HEARING_INTERVALS)[number]

/** Case states that must never produce hearing reminders. */
export const NON_REMINDING_CASE_STATUSES = ['Resolved', 'Dismissed', 'Cancelled']

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/**
 * Resolves the timezone to display a hearing in.
 * Order: the stored hearing_tz, then the legacy state fallback, then UTC.
 * Never uses the server's local timezone.
 */
export type TzResolution = { tz: string; needsReview: boolean; source: 'hearing_tz' | 'state' | 'fallback' }

/**
 * Resolution order: a valid stored hearing_tz, then a RECOGNISED state, then
 * UTC flagged for review. An unknown or misspelled state never becomes Pacific.
 */
export function resolveHearingTzDetailed(hearingTz: string | null, state: string | null): TzResolution {
  if (isValidTimeZone(hearingTz)) return { tz: hearingTz as string, needsReview: false, source: 'hearing_tz' }
  const fromState = stateToTzStrict(state)
  if (isValidTimeZone(fromState)) return { tz: fromState as string, needsReview: false, source: 'state' }
  return { tz: 'UTC', needsReview: true, source: 'fallback' }
}

export function resolveHearingTz(hearingTz: string | null, state: string | null): string {
  return resolveHearingTzDetailed(hearingTz, state).tz
}

/**
 * Formats a UTC instant in the court's timezone, e.g.
 * "Mon, Nov 3, 2026 at 9:00 AM PST". DST is handled by Intl, which applies the
 * offset in force on that date rather than today's offset.
 */
export function formatCourtLocal(at: Date | string, tz: string): string {
  const d = at instanceof Date ? at : new Date(at)
  const zone = isValidTimeZone(tz) ? tz : 'UTC'
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d)
  return `${date} at ${time}`
}

/** Timezone abbreviation in force at that instant, e.g. PST vs PDT. */
export function tzAbbreviation(at: Date | string, tz: string): string {
  const d = at instanceof Date ? at : new Date(at)
  const zone = isValidTimeZone(tz) ? tz : 'UTC'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(d)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC'
}

/** The instant a given interval's reminder becomes due. */
export function reminderInstant(hearingAt: Date | string, interval: HearingInterval): Date {
  const d = hearingAt instanceof Date ? hearingAt : new Date(hearingAt)
  return new Date(d.getTime() - interval.minutes * 60_000)
}

/**
 * Intervals still in the future at `now`. A hearing booked two days out
 * produces only the 24h and 2h reminders: an already-passed interval is never
 * created, so no reminder can fire late.
 */
export function applicableIntervals(hearingAt: Date | string, now: Date = new Date()): HearingInterval[] {
  const d = hearingAt instanceof Date ? hearingAt : new Date(hearingAt)
  if (!Number.isFinite(d.getTime())) return []
  return HEARING_INTERVALS.filter((i) => reminderInstant(d, i).getTime() > now.getTime())
}

/**
 * Schedule-specific event key. It embeds the exact hearing instant, so a
 * rescheduled hearing produces different keys and can never collide with — or
 * be satisfied by — reminders generated for the old date.
 */
export function hearingEventKey(hearingAt: Date | string, intervalKey: string, tz = 'UTC'): string {
  const d = hearingAt instanceof Date ? hearingAt : new Date(hearingAt)
  // The resolved timezone is part of the schedule identity: a timezone-only
  // correction changes the key, so reminders written with the old zone are
  // cancelled and regenerated with the corrected court-local text.
  return `hearing:${d.toISOString()}:${tz}:${intervalKey}`
}

/** Warning shown when the court timezone could not be resolved. */
export const TZ_REVIEW_WARNING =
  'TIMEZONE NEEDS REVIEW — displayed in UTC; verify the court timezone immediately.'

/**
 * Behaviour when the court-timezone selector changes.
 *
 * The UTC instant is the source of truth, so switching timezone re-renders the
 * datetime-local field FROM that instant into the newly selected zone. The old
 * wall-clock text is never silently reinterpreted in the new zone, which would
 * move the actual hearing time.
 *
 * Returns the new datetime-local string, or null when there is no instant yet
 * (a new hearing being typed), in which case the typed wall-clock text stands
 * and is converted with the selected zone at submit time.
 */
export function retimeLocalInput(utcIso: string | null, newTz: string): string | null {
  if (!utcIso) return null
  const d = new Date(utcIso)
  if (!Number.isFinite(d.getTime())) return null
  const zone = isValidTimeZone(newTz) ? newTz : 'UTC'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

/**
 * The value the selector should start with. An invalid legacy timezone is
 * NEVER placed into the controlled selector: it starts blank so the user must
 * make a valid choice, and the review warning is shown alongside.
 */
export function initialSelectorTz(storedTz: string | null): string {
  return isValidTimeZone(storedTz) ? (storedTz as string) : ''
}

/**
 * State transition when the court-timezone selector changes.
 *
 * `manuallyEdited` records whether the user has typed into the date/time
 * field. If they have, their edit is preserved verbatim — changing timezone
 * must never discard it or restore the database value. If they have not, the
 * original UTC instant is re-rendered into the newly selected zone, so
 * repeated timezone-only changes keep pointing at the same instant.
 */

/**
 * State transition when the court-timezone selector changes.
 *
 *  - untouched existing hearing -> keep the ORIGINAL UTC instant and re-render
 *    its court-local value in the newly selected zone. Repeatable: every
 *    calculation starts from the same stored instant, so switching zones many
 *    times never drifts.
 *  - the user has manually edited the date/time -> keep their edit untouched.
 *    It is converted with the newly selected zone at submit time. Recalculating
 *    from the database value here would silently discard what they typed.
 */
export function applyTimezoneChange(
  state: { hearingAt: string; dateTimeEdited: boolean },
  originalUtc: string | null,
  newTz: string,
): { hearingAt: string; hearingTz: string } {
  if (state.dateTimeEdited || !newTz) {
    return { hearingAt: state.hearingAt, hearingTz: newTz }
  }
  const retimed = retimeLocalInput(originalUtc, newTz)
  return { hearingAt: retimed ?? state.hearingAt, hearingTz: newTz }
}

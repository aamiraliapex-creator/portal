import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HEARING_INTERVALS, applicableIntervals, formatCourtLocal, hearingEventKey,
  isValidTimeZone, reminderInstant, resolveHearingTz, tzAbbreviation,
} from '../lib/hearing-time'

const HEARING = '2026-11-03T17:00:00.000Z' // 9:00 AM PST in Los Angeles

test('exactly four intervals are defined: 4d, 3d, 24h, 2h', () => {
  assert.deepEqual(HEARING_INTERVALS.map((i) => i.key), ['4d', '3d', '24h', '2h'])
  // The removed long-range reminders must not reappear.
  for (const banned of ['30d', '14d', '7d']) {
    assert.ok(!HEARING_INTERVALS.some((i) => i.key === banned), `${banned} must not exist`)
  }
})

test('only the 24h and 2h reminders are critical', () => {
  assert.deepEqual(HEARING_INTERVALS.filter((i) => i.critical).map((i) => i.key), ['24h', '2h'])
})

test('reminder instants are computed from the exact UTC hearing time', () => {
  const h = new Date(HEARING)
  assert.equal(reminderInstant(h, HEARING_INTERVALS[0]).toISOString(), '2026-10-30T17:00:00.000Z')
  assert.equal(reminderInstant(h, HEARING_INTERVALS[1]).toISOString(), '2026-10-31T17:00:00.000Z')
  assert.equal(reminderInstant(h, HEARING_INTERVALS[2]).toISOString(), '2026-11-02T17:00:00.000Z')
  assert.equal(reminderInstant(h, HEARING_INTERVALS[3]).toISOString(), '2026-11-03T15:00:00.000Z')
})

test('a hearing booked late yields only the intervals still in the future', () => {
  const h = new Date(HEARING)
  // Two days out: 4d and 3d have passed.
  const late = applicableIntervals(h, new Date('2026-11-01T17:00:00.000Z'))
  assert.deepEqual(late.map((i) => i.key), ['24h', '2h'])
  // Ninety minutes out: nothing may be created.
  assert.deepEqual(applicableIntervals(h, new Date('2026-11-03T15:30:00.000Z')).map((i) => i.key), [])
  // Well ahead: all four.
  assert.equal(applicableIntervals(h, new Date('2026-10-01T00:00:00.000Z')).length, 4)
})

test('an already-passed hearing produces no reminders', () => {
  assert.deepEqual(applicableIntervals(HEARING, new Date('2026-12-01T00:00:00.000Z')), [])
})

test('an invalid hearing date produces no reminders', () => {
  assert.deepEqual(applicableIntervals('not-a-date', new Date()), [])
})

test('UTC instants render in the court timezone, not the server timezone', () => {
  const la = formatCourtLocal(HEARING, 'America/Los_Angeles')
  assert.match(la, /9:00\u202fAM|9:00 AM/)
  assert.match(la, /Nov 3, 2026/)
  const ny = formatCourtLocal(HEARING, 'America/New_York')
  assert.match(ny, /12:00\u202fPM|12:00 PM/, 'the same instant is midday in New York')
})

test('fall DST: a November hearing shows PST, not PDT', () => {
  assert.equal(tzAbbreviation('2026-11-03T17:00:00.000Z', 'America/Los_Angeles'), 'PST')
})

test('spring DST: a June hearing shows PDT', () => {
  assert.equal(tzAbbreviation('2026-06-03T16:00:00.000Z', 'America/Los_Angeles'), 'PDT')
})

test('DST boundary: the same wall-clock hour maps to different UTC instants', () => {
  // 2026 US transitions: forward Mar 8, back Nov 1.
  const before = formatCourtLocal('2026-03-07T18:00:00.000Z', 'America/Los_Angeles') // PST (UTC-8) -> 10:00
  const after = formatCourtLocal('2026-03-09T18:00:00.000Z', 'America/Los_Angeles')  // PDT (UTC-7) -> 11:00
  assert.match(before, /10:00/)
  assert.match(after, /11:00/)
})

test('near-midnight hearings land on the correct court-local calendar day', () => {
  // 03:30 UTC on Nov 4 is 19:30 on Nov 3 in Los Angeles.
  const s = formatCourtLocal('2026-11-04T03:30:00.000Z', 'America/Los_Angeles')
  assert.match(s, /Nov 3, 2026/, 'must not roll forward a day')
  assert.match(s, /7:30\u202fPM|7:30 PM/)
})

test('timezone resolution falls back to state, then UTC, and rejects invalid zones', () => {
  assert.equal(resolveHearingTz('America/New_York', null), 'America/New_York')
  // Legacy row with no hearing_tz falls back to the state mapping.
  assert.equal(resolveHearingTz(null, 'CA'), 'America/Los_Angeles')
  // An invalid stored zone must not be trusted.
  assert.equal(resolveHearingTz('Mars/Olympus', null), 'UTC')
  assert.equal(isValidTimeZone('Mars/Olympus'), false)
  assert.equal(isValidTimeZone('America/Chicago'), true)
})

test('event keys are schedule-specific so a reschedule cannot collide', () => {
  const tz = 'America/Los_Angeles'
  const oldKey = hearingEventKey('2026-11-03T17:00:00.000Z', '24h', tz)
  const newKey = hearingEventKey('2026-11-10T17:00:00.000Z', '24h', tz)
  assert.notEqual(oldKey, newKey, 'a new hearing date must produce a new key')
  assert.equal(hearingEventKey('2026-11-03T17:00:00.000Z', '24h', tz), oldKey, 'stable for the same schedule')
  assert.match(oldKey, /^hearing:2026-11-03T17:00:00\.000Z:America\/Los_Angeles:24h$/)
})

test('a timezone-only correction changes the schedule identity', () => {
  const instant = '2026-11-03T17:00:00.000Z'
  const pacific = hearingEventKey(instant, '24h', 'America/Los_Angeles')
  const eastern = hearingEventKey(instant, '24h', 'America/New_York')
  assert.notEqual(pacific, eastern,
    'the same UTC instant in a different court timezone must be a different schedule')
})

// ---------------------------------------------- strict state resolution
test('unknown, blank and misspelled states never map to Pacific', async () => {
  const { stateToTzStrict } = await import('../lib/timezones')
  const { resolveHearingTzDetailed } = await import('../lib/hearing-time')

  for (const bad of [null, undefined, '', '   ', 'ZZ', 'Califrnia', 'Not A State', 'XX']) {
    assert.equal(stateToTzStrict(bad as string | null), null, `${String(bad)} must not resolve`)
    const r = resolveHearingTzDetailed(null, bad as string | null)
    assert.equal(r.tz, 'UTC', `${String(bad)} must fall back to UTC, never Pacific`)
    assert.equal(r.needsReview, true, 'the fallback must be flagged for review')
    assert.notEqual(r.tz, 'America/Los_Angeles')
  }
})

test('valid abbreviations and full state names resolve correctly', async () => {
  const { stateToTzStrict } = await import('../lib/timezones')
  assert.equal(stateToTzStrict('CA'), 'America/Los_Angeles')
  assert.equal(stateToTzStrict('ca'), 'America/Los_Angeles')
  assert.equal(stateToTzStrict('California'), 'America/Los_Angeles')
  assert.equal(stateToTzStrict('new york'), 'America/New_York')
  assert.equal(stateToTzStrict('WA'), 'America/Los_Angeles')
  assert.equal(stateToTzStrict('Texas'), 'America/Chicago')
})

test('resolution order: hearing_tz wins, then a recognised state, then flagged UTC', async () => {
  const { resolveHearingTzDetailed } = await import('../lib/hearing-time')
  assert.deepEqual(resolveHearingTzDetailed('America/New_York', 'CA'),
    { tz: 'America/New_York', needsReview: false, source: 'hearing_tz' })
  assert.deepEqual(resolveHearingTzDetailed(null, 'CA'),
    { tz: 'America/Los_Angeles', needsReview: false, source: 'state' })
  assert.deepEqual(resolveHearingTzDetailed('Mars/Olympus', 'Nowhere'),
    { tz: 'UTC', needsReview: true, source: 'fallback' })
})

test('DST-correct court-local rendering still holds after the strict change', async () => {
  const { formatCourtLocal, tzAbbreviation } = await import('../lib/hearing-time')
  assert.equal(tzAbbreviation('2026-11-03T17:00:00.000Z', 'America/Los_Angeles'), 'PST')
  assert.equal(tzAbbreviation('2026-06-03T16:00:00.000Z', 'America/Los_Angeles'), 'PDT')
  assert.match(formatCourtLocal('2026-11-04T03:30:00.000Z', 'America/Los_Angeles'), /Nov 3, 2026/)
})

// ------------------------------- form timezone behaviour (executed directly)
test('changing the timezone re-renders the local field from the same UTC instant', async () => {
  const { retimeLocalInput } = await import('../lib/hearing-time')
  // 2026-11-10T20:00Z is 13:00 in Denver (MST) and 14:00 in Chicago (CST).
  const instant = '2026-11-10T20:00:00.000Z'
  assert.equal(retimeLocalInput(instant, 'America/Denver'), '2026-11-10T13:00')
  assert.equal(retimeLocalInput(instant, 'America/Chicago'), '2026-11-10T14:00')
  // The old wall-clock text is never reinterpreted: 13:00 Denver does not
  // become 13:00 Chicago (which would move the hearing by an hour).
  assert.notEqual(retimeLocalInput(instant, 'America/Chicago'), '2026-11-10T13:00')
})

test('retimeLocalInput handles day rollover and an absent instant', async () => {
  const { retimeLocalInput } = await import('../lib/hearing-time')
  // 03:30Z on Nov 4 is 21:30 on Nov 3 in Denver.
  assert.equal(retimeLocalInput('2026-11-04T03:30:00.000Z', 'America/Denver'), '2026-11-03T20:30')
  // A new hearing with no stored instant keeps whatever the user typed.
  assert.equal(retimeLocalInput(null, 'America/Chicago'), null)
  assert.equal(retimeLocalInput('not-a-date', 'America/Chicago'), null)
})

test('an invalid legacy timezone is never loaded into the controlled selector', async () => {
  const { initialSelectorTz } = await import('../lib/hearing-time')
  for (const bad of [null, '', 'Mars/Olympus', 'Not/AZone']) {
    assert.equal(initialSelectorTz(bad), '', `${String(bad)} must leave the selector blank`)
  }
  assert.equal(initialSelectorTz('America/Denver'), 'America/Denver', 'a valid zone is preserved')
})

test('a Denver→Chicago correction preserves the UTC instant end to end', async () => {
  const { retimeLocalInput } = await import('../lib/hearing-time')
  const { localInputToUtcIso } = await import('../lib/timezones')
  const instant = '2026-11-10T20:00:00.000Z'

  // The form re-renders the local field for the new zone...
  const retimed = retimeLocalInput(instant, 'America/Chicago')
  assert.equal(retimed, '2026-11-10T14:00')
  // ...and submitting that value with the new zone yields the SAME instant.
  assert.equal(new Date(localInputToUtcIso(retimed!, 'America/Chicago')).toISOString(), instant)
})

// -------------------- timezone-selector interaction (A–D), executed directly
// These drive the exact reducer the form calls on every selector change, with
// the same state shape the component holds.
test('A: timezone-only change on an untouched hearing keeps the UTC instant', async () => {
  const { applyTimezoneChange } = await import('../lib/hearing-time')
  const { localInputToUtcIso } = await import('../lib/timezones')
  const stored = '2026-11-10T20:00:00.000Z'

  let state = { hearingAt: '2026-11-10T13:00', dateTimeEdited: false } // Denver
  const next = applyTimezoneChange(state, stored, 'America/Chicago')
  assert.equal(next.hearingAt, '2026-11-10T14:00', 'the displayed local value changes')
  assert.equal(new Date(localInputToUtcIso(next.hearingAt, next.hearingTz)).toISOString(), stored,
    'the submitted UTC instant is identical')
})

test('B: changing timezone after a manual edit must not restore the database time', async () => {
  const { applyTimezoneChange } = await import('../lib/hearing-time')
  const stored = '2026-11-10T20:00:00.000Z'
  // The user typed a new wall-clock time, so the field is dirty.
  const edited = { hearingAt: '2026-12-01T09:30', dateTimeEdited: true }
  const next = applyTimezoneChange(edited, stored, 'America/Chicago')
  assert.equal(next.hearingAt, '2026-12-01T09:30', 'the edit survives the timezone change')
  assert.notEqual(next.hearingAt, '2026-11-10T14:00', 'the original database time must not come back')
  assert.equal(next.hearingTz, 'America/Chicago')
})

test('C: repeated timezone changes without editing never drift', async () => {
  const { applyTimezoneChange } = await import('../lib/hearing-time')
  const { localInputToUtcIso } = await import('../lib/timezones')
  const stored = '2026-11-10T20:00:00.000Z'

  let state = { hearingAt: '2026-11-10T13:00', dateTimeEdited: false }
  for (const tz of ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Chicago', 'America/Los_Angeles']) {
    const r = applyTimezoneChange(state, stored, tz)
    assert.equal(new Date(localInputToUtcIso(r.hearingAt, tz)).toISOString(), stored,
      `the instant must survive a switch to ${tz}`)
    state = { hearingAt: r.hearingAt, dateTimeEdited: false }
  }
})

test('D: an invalid legacy timezone leaves the selector blank and blocks saving', async () => {
  const { initialSelectorTz, resolveHearingTzDetailed, applyTimezoneChange } = await import('../lib/hearing-time')
  assert.equal(initialSelectorTz('Mars/Olympus'), '', 'the invalid zone never enters the selector')
  const res = resolveHearingTzDetailed('Mars/Olympus', 'ZZ')
  assert.equal(res.tz, 'UTC')
  assert.equal(res.needsReview, true, 'the review warning is shown')

  // With a blank selection the submit guard has no timezone to use.
  const blank = applyTimezoneChange({ hearingAt: '2026-11-10T13:00', dateTimeEdited: false }, '2026-11-10T20:00:00.000Z', '')
  assert.equal(blank.hearingTz, '', 'no timezone is selected yet')
  assert.equal(blank.hearingAt, '2026-11-10T13:00', 'nothing is recalculated without a valid zone')
})

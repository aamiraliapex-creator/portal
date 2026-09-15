// Unit tests that import and EXECUTE the real validation helpers used by the
// API routes (no source-text matching): if a route's guard regresses, these fail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CASE_STATUSES, CASE_PRIORITIES, TRISTATE, YES_NO, HEARING_TYPES, PREP_STATUSES,
  PLANS, SUB_STATUSES, PAY_CHANNELS, LIMITS,
  pickEnum, parseText, parseMoney, parseDate, parseDateOnly, firstError,
} from '../lib/validation'

// ---------------------------------------------------------------- pickEnum
test('pickEnum accepts allowlisted values and falls back when absent', () => {
  assert.deepEqual(pickEnum('Resolved', CASE_STATUSES, 'New', 'case status'), { ok: true, value: 'Resolved' })
  assert.deepEqual(pickEnum(undefined, CASE_STATUSES, 'New', 'case status'), { ok: true, value: 'New' })
  assert.deepEqual(pickEnum('', CASE_PRIORITIES, 'Normal', 'priority'), { ok: true, value: 'Normal' })
})

test('pickEnum rejects values outside the allowlist for every enum used by the APIs', () => {
  const cases: [unknown, readonly string[], string][] = [
    ['DROP TABLE users', CASE_STATUSES, 'case status'],
    ['Critical', CASE_PRIORITIES, 'priority'],
    ['Maybe', TRISTATE, 'CMV value'],
    ['Sometimes', YES_NO, 'CDL value'],
    ['Telepathy', HEARING_TYPES, 'hearing type'],
    ['Almost', PREP_STATUSES, 'preparation status'],
    ['Free Plan', PLANS, 'plan'],
    ['Lapsed', SUB_STATUSES, 'subscription status'],
    ['Crypto', PAY_CHANNELS, 'payment channel'],
  ]
  for (const [value, allowed, label] of cases) {
    const r = pickEnum(value, allowed as readonly string[] as never, null, label)
    assert.equal(r.ok, false, `${label}: "${String(value)}" must be rejected`)
  }
})

test('pickEnum rejects non-string types (objects, numbers, arrays)', () => {
  for (const v of [{}, [], 42, true]) {
    assert.equal(pickEnum(v, CASE_STATUSES, 'New', 'case status').ok, false)
  }
})

// ---------------------------------------------------------------- parseMoney
test('parseMoney rejects NaN, Infinity and negative amounts', () => {
  for (const v of ['abc', 'NaN', NaN, 'Infinity', Infinity, -Infinity, -1, -0.01]) {
    const r = parseMoney(v, 'Fee')
    assert.equal(r.ok, false, `amount ${String(v)} must be rejected`)
  }
})

test('parseMoney rejects excessive amounts but accepts sane ones', () => {
  assert.equal(parseMoney(LIMITS.money + 1, 'Fee').ok, false)
  assert.deepEqual(parseMoney(500, 'Fee'), { ok: true, value: 500 })
  assert.deepEqual(parseMoney('500.25', 'Fee'), { ok: true, value: 500.25 })
})

test('parseMoney treats empty input as "not supplied" rather than zero', () => {
  assert.deepEqual(parseMoney('', 'Fee'), { ok: true, value: null })
  assert.deepEqual(parseMoney(undefined, 'Fee'), { ok: true, value: null })
  assert.deepEqual(parseMoney(null, 'Fee'), { ok: true, value: null })
})

// ---------------------------------------------------------------- dates
test('parseDate rejects unparseable and nonsense dates', () => {
  for (const v of ['not-a-date', '2026-13-45', {}, 'Infinity']) {
    assert.equal(parseDate(v, 'Hearing date').ok, false, `${String(v)} must be rejected`)
  }
})

test('parseDate accepts an ISO datetime and returns a real Date', () => {
  const r = parseDate('2026-11-03T09:00:00.000Z', 'Hearing date')
  assert.equal(r.ok, true)
  if (r.ok) { assert.ok(r.value instanceof Date); assert.equal(Number.isNaN(r.value!.getTime()), false) }
})

test('parseDateOnly rejects malformed calendar dates', () => {
  for (const v of ['31-12-2026', '2026-02-31', 'yesterday']) {
    assert.equal(parseDateOnly(v, 'Date of birth').ok, false, `${String(v)} must be rejected`)
  }
  assert.deepEqual(parseDateOnly('1990-05-01', 'Date of birth'), { ok: true, value: '1990-05-01' })
})

// ---------------------------------------------------------------- parseText
test('parseText enforces length limits and trims', () => {
  assert.equal(parseText('x'.repeat(LIMITS.shortText + 1), LIMITS.shortText, 'Citation').ok, false)
  assert.deepEqual(parseText('  T-1001  ', LIMITS.shortText, 'Citation'), { ok: true, value: 'T-1001' })
  assert.deepEqual(parseText('', LIMITS.shortText, 'Citation'), { ok: true, value: null })
})

// ---------------------------------------------------------------- firstError
test('firstError surfaces the first failing field and is null when all pass', () => {
  const good = parseText('ok', 50, 'A')
  const bad = parseMoney(-5, 'Fee')
  assert.equal(firstError(good, good), null)
  assert.equal(typeof firstError(good, bad), 'string')
})

// ---------------------------------------------------------------- UI ↔ API contract
// The customer form must submit values the API allowlist accepts. Previously the
// form submitted the visible label ("Fleet Protection ($39.99)") while the API
// only accepted "Fleet Protection", so every plan choice was rejected.
test('every plan option value in the customer form is in the API PLANS allowlist', async () => {
  const { readFileSync } = await import('node:fs')
  const form = readFileSync('app/(app)/customers/new/CustomerForm.tsx', 'utf8')
  const values = [...form.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1])
  const planValues = values.filter((v) => /Fleet Protection|Individual Plan|One time Team/.test(v))

  assert.ok(planValues.length >= 3, `expected 3 plan option values, found ${JSON.stringify(planValues)}`)
  for (const v of planValues) {
    const r = pickEnum(v, PLANS, null, 'plan')
    assert.equal(r.ok, true, `form submits plan "${v}" which the API allowlist rejects`)
  }
  // The visible label must NOT be a valid submitted value.
  assert.equal(pickEnum('Fleet Protection ($39.99)', PLANS, null, 'plan').ok, false)
})

// ---------------------------------------------------------------- email input
test('normalizeEmail trims and lowercases', async () => {
  const { normalizeEmail } = await import('../lib/validation')
  assert.equal(normalizeEmail('  Owner@Example.TEST  '), 'owner@example.test')
})

test('isValidEmail accepts sane addresses and rejects malformed/oversized ones', async () => {
  const { isValidEmail, EMAIL_MAX_LENGTH } = await import('../lib/validation')
  assert.equal(isValidEmail('owner@example.test'), true)
  for (const bad of ['', 'no-at-sign', 'two@@at.test', 'spaces in@mail.test', 'trailing@dot', '@example.test']) {
    assert.equal(isValidEmail(bad), false, `${bad} must be rejected`)
  }
  assert.equal(isValidEmail('a'.repeat(EMAIL_MAX_LENGTH) + '@example.test'), false)
})

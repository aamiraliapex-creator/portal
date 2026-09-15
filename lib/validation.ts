/**
 * Pure, importable request-validation helpers.
 *
 * These live outside the route handlers so they can be unit-tested directly
 * (tests/validation.test.ts) rather than asserted against source text, and so
 * every route applies identical rules.
 */

// ---------------------------------------------------------------- allowlists
export const CASE_STATUSES = [
  'New', 'Action Required', 'Hearing Scheduled', 'Waiting for Court',
  'Motion Prep', 'Under Review', 'Resolved', 'Dismissed',
] as const
export const CASE_PRIORITIES = ['Low', 'Normal', 'High'] as const
export const TRISTATE = ['Yes', 'No', 'Unknown'] as const          // CMV / CDL on a case
export const YES_NO = ['Yes', 'No'] as const                        // CDL / DOT on a customer
export const HEARING_TYPES = ['In person', 'Zoom', 'Phone'] as const
export const PREP_STATUSES = ['Not started', 'In progress', 'Ready'] as const
export const PLANS = ['Fleet Protection', 'Individual Plan', 'One time Team'] as const
export const SUB_STATUSES = ['Active', 'Past due', 'Cancelled', 'None'] as const
export const PAY_CHANNELS = ['Card', 'Zelle', 'ACH', 'Cash', 'Check'] as const

// ------------------------------------------------------------------- limits
export const LIMITS = {
  shortText: 120,      // citation, court, names, licence numbers
  state: 40,
  tinyText: 60,
  money: 1_000_000,    // rejects absurd fine/fee values
} as const

export type Ok<T> = { ok: true; value: T }
/**
 * `value` is declared (as `undefined`) on the error branch too, so that routes
 * can read `result.value` after an aggregate `firstError()` check without
 * TypeScript complaining that the union might be an `Err`. Routes always return
 * early when `firstError()` is non-null, so the value is only read when valid.
 */
export type Err = { ok: false; error: string; value?: undefined }
export type Result<T> = Ok<T> | Err

const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
const err = (error: string): Err => ({ ok: false, error })

/** Value must be one of `allowed`; `undefined`/`null`/'' falls back to `fallback`. */
export function pickEnum<T extends readonly string[]>(
  value: unknown, allowed: T, fallback: T[number] | null, label: string,
): Result<T[number] | null> {
  if (value === undefined || value === null || value === '') return ok(fallback)
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return err(`Invalid ${label}.`)
  }
  return ok(value as T[number])
}

/** Trimmed text with a maximum length. Empty becomes null. */
export function parseText(value: unknown, max: number, label: string): Result<string | null> {
  if (value === undefined || value === null) return ok(null)
  if (typeof value !== 'string') return err(`Invalid ${label}.`)
  const s = value.trim()
  if (s === '') return ok(null)
  if (s.length > max) return err(`${label} must be ${max} characters or fewer.`)
  return ok(s)
}

/**
 * Money amount. Rejects NaN, Infinity/-Infinity, negatives and values above
 * `max`; rounds to 2 decimal places. Empty/absent becomes null.
 */
export function parseMoney(value: unknown, label: string, max: number = LIMITS.money): Result<number | null> {
  if (value === undefined || value === null || value === '') return ok(null)
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) return err(`${label} must be a valid number.`)
  if (n < 0) return err(`${label} cannot be negative.`)
  if (n > max) return err(`${label} is too large.`)
  return ok(Math.round(n * 100) / 100)
}

/** Calendar date / timestamp. Rejects unparseable and absurd values. */
export function parseDate(value: unknown, label: string): Result<Date | null> {
  if (value === undefined || value === null || value === '') return ok(null)
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
    return err(`Invalid ${label}.`)
  }
  const d = value instanceof Date ? value : new Date(value as string | number)
  if (isNaN(d.getTime())) return err(`${label} is not a valid date.`)
  const year = d.getUTCFullYear()
  if (year < 1900 || year > 2200) return err(`${label} is out of range.`)
  return ok(d)
}

/**
 * Date-only string (YYYY-MM-DD) suitable for a Postgres `date` column.
 *
 * JavaScript's Date silently rolls impossible calendar dates over
 * ("2026-02-31" becomes 2026-03-03), which would store a date the user never
 * entered. For YYYY-MM-DD input we therefore verify the parsed date round-trips
 * back to exactly what was supplied and reject it otherwise.
 */
export function parseDateOnly(value: unknown, label: string): Result<string | null> {
  const r = parseDate(value, label)
  if (!r.ok) return r
  if (!r.value) return ok(null)
  const iso = r.value.toISOString().slice(0, 10)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && trimmed !== iso) {
      return err(`${label} is not a real calendar date.`)
    }
  }
  return ok(iso)
}

/** Collects several Results, returning the first error. */
export function firstError(...results: Result<unknown>[]): string | null {
  for (const r of results) if (!r.ok) return r.error
  return null
}

/** RFC 5321 caps an address at 254 characters. */
export const EMAIL_MAX_LENGTH = 254

/** Trim + lowercase. Does not validate. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Pragmatic syntax check: one @, no whitespace, a dot-bearing domain, and
 * within the RFC length limit. Deliberately conservative rather than clever.
 */
export function isValidEmail(value: string): boolean {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

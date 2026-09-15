// Behavioural tests for post-login redirect handling (open-redirect defence).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeNextPath, DEFAULT_POST_LOGIN_PATH, POST_LOGIN_PATHS } from '../lib/safe-redirect'

const ORIGIN = 'https://portal.example.com'

test('a valid internal path is preserved', () => {
  assert.equal(safeNextPath('/dashboard', ORIGIN), '/dashboard')
  assert.equal(safeNextPath('/customers', ORIGIN), '/customers')
  assert.equal(safeNextPath('/customers/abc123', ORIGIN), '/customers/abc123')
  assert.equal(safeNextPath('/payments?tab=invoices', ORIGIN), '/payments?tab=invoices')
})

test('protocol-relative targets are rejected (//evil.example)', () => {
  assert.equal(safeNextPath('//evil.example', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('//evil.example/dashboard', ORIGIN), DEFAULT_POST_LOGIN_PATH)
})

test('backslash-smuggled targets are rejected (/\\evil.example)', () => {
  assert.equal(safeNextPath('/\\evil.example', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('\\\\evil.example', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('/dashboard\\@evil.example', ORIGIN), DEFAULT_POST_LOGIN_PATH)
})

test('percent-encoded backslashes are rejected', () => {
  assert.equal(safeNextPath('/%5Cevil.example', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('/%5cevil.example', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('%5C%5Cevil.example', ORIGIN), DEFAULT_POST_LOGIN_PATH)
})

test('absolute URLs to other origins are rejected', () => {
  assert.equal(safeNextPath('https://evil.example/dashboard', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('http://evil.example', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('https://portal.example.com.evil.example/dashboard', ORIGIN), DEFAULT_POST_LOGIN_PATH)
})

test('an absolute URL on our own origin is reduced to its internal path', () => {
  assert.equal(safeNextPath(`${ORIGIN}/customers`, ORIGIN), '/customers')
})

test('javascript: and data: URLs are rejected', () => {
  assert.equal(safeNextPath('javascript:alert(1)', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('JaVaScRiPt:alert(1)', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('data:text/html,<script>alert(1)</script>', ORIGIN), DEFAULT_POST_LOGIN_PATH)
})

test('paths outside the application allowlist fall back to the default', () => {
  assert.equal(safeNextPath('/api/users', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('/login', ORIGIN), DEFAULT_POST_LOGIN_PATH)
  assert.equal(safeNextPath('/not-a-route', ORIGIN), DEFAULT_POST_LOGIN_PATH)
})

test('empty, missing and malformed values fall back to the default', () => {
  for (const v of ['', null, undefined, '   ']) {
    assert.equal(safeNextPath(v as string | null | undefined, ORIGIN), DEFAULT_POST_LOGIN_PATH, String(v))
  }
})

test('every allowlisted route is itself accepted', () => {
  for (const p of POST_LOGIN_PATHS) assert.equal(safeNextPath(p, ORIGIN), p)
})

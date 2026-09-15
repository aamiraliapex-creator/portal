// Behavioural tests for the password policy helpers (imported and executed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BCRYPT_MAX_BYTES, PASSWORD_MAX_INPUT_BYTES, DUMMY_PASSWORD_HASH,
  passwordByteLength, isWithinBcryptLimit, hashPassword, verifyPassword, verifyPasswordConstantish,
} from '../lib/password'

test('bcrypt limit is measured in BYTES, not characters', () => {
  assert.equal(passwordByteLength('a'.repeat(72)), 72)
  assert.equal(isWithinBcryptLimit('a'.repeat(72)), true)
  assert.equal(isWithinBcryptLimit('a'.repeat(73)), false)
  // 'é' is 2 bytes in UTF-8: 37 of them exceed 72 bytes despite being 37 chars.
  assert.equal(passwordByteLength('é'.repeat(37)), 74)
  assert.equal(isWithinBcryptLimit('é'.repeat(37)), false)
})

test('hashPassword refuses to silently truncate an over-long password', async () => {
  await assert.rejects(() => hashPassword('a'.repeat(73)), /at most 72 bytes/)
  const ok = await hashPassword('a'.repeat(72))
  assert.match(ok, /^\$2[aby]\$/)
})

test('two passwords sharing a 72-byte prefix are not interchangeable (limit enforced, not truncated)', async () => {
  const base = 'a'.repeat(72)
  const hash = await hashPassword(base)
  // bcrypt itself would accept the longer value; our policy stops it upstream.
  assert.equal(isWithinBcryptLimit(base + 'DIFFERENT'), false)
  assert.equal(await verifyPassword(base, hash), true)
})

test('the dummy hash is a real bcrypt hash that matches nothing we use', async () => {
  assert.match(DUMMY_PASSWORD_HASH, /^\$2[aby]\$/)
  assert.equal(await verifyPassword('anything', DUMMY_PASSWORD_HASH), false)
})

test('verifyPasswordConstantish still hashes when there is no stored hash', async () => {
  const t0 = Date.now()
  assert.equal(await verifyPasswordConstantish('some-password', null), false)
  const missingAccountMs = Date.now() - t0

  const hash = await hashPassword('some-password')
  const t1 = Date.now()
  assert.equal(await verifyPasswordConstantish('some-password', hash), true)
  const realAccountMs = Date.now() - t1

  // Both paths must do real bcrypt work; a short-circuit would be near-instant.
  assert.ok(missingAccountMs > 5, `missing-account path looked like a short-circuit (${missingAccountMs}ms)`)
  assert.ok(realAccountMs > 5, `real-account path unexpectedly fast (${realAccountMs}ms)`)
})

test('input cap is larger than the bcrypt limit but still bounded', () => {
  assert.ok(PASSWORD_MAX_INPUT_BYTES > BCRYPT_MAX_BYTES)
  assert.ok(PASSWORD_MAX_INPUT_BYTES <= 4096)
})

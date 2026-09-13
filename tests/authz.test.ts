import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canWriteBusinessData, canManageSettings, canManageUsers, canDeleteUsers, canManageRole,
  isRole, isStatus, rankOf, type CurrentUser,
} from '../lib/permissions'

function user(role: string): CurrentUser {
  return { id: 'u1', name: 'Test', email: 't@example.com', role: role as CurrentUser['role'], tokenVersion: 0 }
}

test('isRole / isStatus reject unknown values (allowlist enforcement)', () => {
  assert.equal(isRole('SUPER_ADMIN'), true)
  assert.equal(isRole('READ_ONLY'), true)
  assert.equal(isRole('OWNER'), false) // not a real role — must not be silently accepted
  assert.equal(isRole(''), false)
  assert.equal(isRole(undefined), false)
  assert.equal(isStatus('ACTIVE'), true)
  assert.equal(isStatus('DISABLED'), true)
  assert.equal(isStatus('SUSPENDED'), false)
})

test('READ_ONLY cannot write business data; every other active role can', () => {
  assert.equal(canWriteBusinessData(user('READ_ONLY')), false)
  for (const r of ['DOCUMENT_STAFF', 'BILLING', 'SALES_AGENT', 'CASE_AGENT', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']) {
    assert.equal(canWriteBusinessData(user(r)), true, `${r} should be able to write business data`)
  }
  assert.equal(canWriteBusinessData(null), false)
})

test('settings management requires MANAGER rank or above', () => {
  assert.equal(canManageSettings(user('CASE_AGENT')), false)
  assert.equal(canManageSettings(user('READ_ONLY')), false)
  assert.equal(canManageSettings(user('MANAGER')), true)
  assert.equal(canManageSettings(user('ADMIN')), true)
  assert.equal(canManageSettings(user('SUPER_ADMIN')), true)
})

test('user management requires ADMIN rank or above', () => {
  assert.equal(canManageUsers(user('MANAGER')), false)
  assert.equal(canManageUsers(user('ADMIN')), true)
  assert.equal(canManageUsers(user('SUPER_ADMIN')), true)
})

test('only SUPER_ADMIN can delete users', () => {
  assert.equal(canDeleteUsers(user('ADMIN')), false)
  assert.equal(canDeleteUsers(user('SUPER_ADMIN')), true)
})

test('privilege escalation: ADMIN cannot manage ADMIN or SUPER_ADMIN roles', () => {
  const admin = user('ADMIN')
  assert.equal(canManageRole(admin, 'READ_ONLY'), true)
  assert.equal(canManageRole(admin, 'CASE_AGENT'), true)
  assert.equal(canManageRole(admin, 'MANAGER'), true)
  assert.equal(canManageRole(admin, 'ADMIN'), false, 'ADMIN must not be able to manage another ADMIN')
  assert.equal(canManageRole(admin, 'SUPER_ADMIN'), false, 'ADMIN must not be able to manage a SUPER_ADMIN')
})

test('SUPER_ADMIN can manage any role, including other SUPER_ADMINs', () => {
  const sa = user('SUPER_ADMIN')
  for (const r of ['READ_ONLY', 'CASE_AGENT', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']) {
    assert.equal(canManageRole(sa, r), true)
  }
})

test('peer roles cannot manage each other (rank equality is not "below")', () => {
  const manager = user('MANAGER')
  assert.equal(canManageRole(manager, 'MANAGER'), false)
  const caseAgent = user('CASE_AGENT')
  assert.equal(canManageRole(caseAgent, 'BILLING'), false) // same rank, different label
})

test('rankOf returns -1 for unrecognized roles (fails closed, not open)', () => {
  assert.equal(rankOf('NOT_A_ROLE'), -1)
  assert.ok(rankOf('READ_ONLY') > rankOf('NOT_A_ROLE'))
})

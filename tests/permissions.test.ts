// Exhaustive behavioural tests for the permission matrix and role hierarchy.
// These IMPORT AND EXECUTE the real functions — no source-text inspection.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLES, PERMISSIONS, ROLE_RANK, USER_STATUSES,
  hasPermission, canManageRole, isRole, isUserStatus,
  ASSIGNABLE_AGENT_ROLES, isAssignableAgentRole,
  type Role, type Permission,
} from '../lib/authz'

/** The intended matrix, written out independently of lib/authz's own table. */
const EXPECTED: Record<Permission, Role[]> = {
  'customer.create':   ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_AGENT', 'CASE_AGENT'],
  'customer.update':   ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_AGENT', 'CASE_AGENT'],
  'case.create':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT'],
  'case.update':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT'],
  'payment.create':    ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING'],
  'task.create':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF'],
  'task.update':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF'],
  'assignment.update': ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'settings.update':   ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'user.manage':       ['SUPER_ADMIN', 'ADMIN'],
  'user.delete':       ['SUPER_ADMIN'],
  'report.export':     ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING', 'CASE_AGENT', 'SALES_AGENT', 'DOCUMENT_STAFF', 'READ_ONLY'],
  'schema.migrate':    ['SUPER_ADMIN'],
}

test('every role × permission combination matches the intended matrix', () => {
  assert.equal(PERMISSIONS.length, Object.keys(EXPECTED).length, 'a permission was added or removed without updating this test')
  for (const perm of PERMISSIONS) {
    for (const role of ROLES) {
      const expected = EXPECTED[perm].includes(role)
      assert.equal(hasPermission(role, perm), expected, `${role} × ${perm}: expected ${expected}`)
    }
  }
})

test('READ_ONLY holds no write permission at all', () => {
  const writes = PERMISSIONS.filter((p) => p !== 'report.export')
  for (const perm of writes) {
    assert.equal(hasPermission('READ_ONLY', perm), false, `READ_ONLY must not hold ${perm}`)
  }
})

test('SUPER_ADMIN holds every permission', () => {
  for (const perm of PERMISSIONS) assert.equal(hasPermission('SUPER_ADMIN', perm), true, perm)
})

test('only SUPER_ADMIN may delete users or migrate the schema', () => {
  for (const role of ROLES) {
    const expected = role === 'SUPER_ADMIN'
    assert.equal(hasPermission(role, 'user.delete'), expected, `${role} user.delete`)
    assert.equal(hasPermission(role, 'schema.migrate'), expected, `${role} schema.migrate`)
  }
})

test('unknown, malformed and empty roles hold no permissions', () => {
  for (const bogus of ['ROOT', '', 'super_admin', 'Admin', null, undefined, 42, {}, []]) {
    for (const perm of PERMISSIONS) {
      assert.equal(hasPermission(bogus as unknown as string, perm), false, `${String(bogus)} × ${perm}`)
    }
  }
})

// ------------------------------------------------------------ canManageRole
test('canManageRole: only a SUPER_ADMIN may manage a SUPER_ADMIN', () => {
  for (const actor of ROLES) {
    assert.equal(canManageRole(actor, 'SUPER_ADMIN'), actor === 'SUPER_ADMIN', `${actor} -> SUPER_ADMIN`)
  }
})

test('canManageRole: an actor may only manage strictly less privileged roles', () => {
  for (const actor of ROLES) {
    for (const target of ROLES) {
      const allowed = canManageRole(actor, target)
      if (!hasPermission(actor, 'user.manage')) {
        assert.equal(allowed, false, `${actor} has no user.manage yet managed ${target}`)
        continue
      }
      const expected = target === 'SUPER_ADMIN'
        ? actor === 'SUPER_ADMIN'
        : ROLE_RANK[actor] < ROLE_RANK[target]
      assert.equal(allowed, expected, `${actor} -> ${target}`)
    }
  }
})

test('canManageRole: nobody may manage a peer of equal rank', () => {
  const peers: [Role, Role][] = [['CASE_AGENT', 'SALES_AGENT'], ['BILLING', 'DOCUMENT_STAFF'], ['ADMIN', 'ADMIN'], ['MANAGER', 'MANAGER']]
  for (const [a, b] of peers) assert.equal(canManageRole(a, b), false, `${a} -> ${b}`)
})

test('canManageRole rejects unknown role strings on either side', () => {
  assert.equal(canManageRole('SUPER_ADMIN', 'ROOT'), false)
  assert.equal(canManageRole('ROOT', 'READ_ONLY'), false)
  assert.equal(canManageRole('', ''), false)
})

// ------------------------------------------------------------ guards + agents
test('isRole and isUserStatus accept only allowlisted values', () => {
  for (const r of ROLES) assert.equal(isRole(r), true, r)
  for (const s of USER_STATUSES) assert.equal(isUserStatus(s), true, s)
  for (const bogus of ['ROOT', 'active', '', null, undefined, 1, {}]) {
    assert.equal(isRole(bogus), false, `isRole(${String(bogus)})`)
    assert.equal(isUserStatus(bogus), false, `isUserStatus(${String(bogus)})`)
  }
})

test('ASSIGNABLE_AGENT_ROLES excludes READ_ONLY, BILLING and DOCUMENT_STAFF', () => {
  for (const role of ['READ_ONLY', 'BILLING', 'DOCUMENT_STAFF'] as Role[]) {
    assert.equal(isAssignableAgentRole(role), false, `${role} must not be assignable as an agent`)
    assert.equal(ASSIGNABLE_AGENT_ROLES.includes(role), false, role)
  }
})

test('every role is either assignable as an agent or explicitly excluded', () => {
  for (const role of ROLES) {
    assert.equal(isAssignableAgentRole(role), ASSIGNABLE_AGENT_ROLES.includes(role), role)
  }
  for (const bogus of ['ROOT', '', null, undefined, 7]) {
    assert.equal(isAssignableAgentRole(bogus), false, String(bogus))
  }
})

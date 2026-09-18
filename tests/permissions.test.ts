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
  'customer.create':   ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'customer.update':   ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'case.create':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT'],
  'case.update':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT'],
  'payment.create':    ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING'],
  'task.create':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF'],
  'task.update':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF'],
  'document.create':   ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DOCUMENT_STAFF', 'CASE_AGENT'],
  'document.update':   ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DOCUMENT_STAFF', 'CASE_AGENT'],
  'assignment.update': ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'settings.update':   ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
  'user.manage':       ['SUPER_ADMIN', 'ADMIN'],
  'user.delete':       ['SUPER_ADMIN'],
  'report.view':       ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'BILLING', 'CASE_AGENT', 'SALES_AGENT', 'DOCUMENT_STAFF', 'READ_ONLY'],
  'report.export':     ['SUPER_ADMIN', 'ADMIN'],
  'record.approve':    ['SUPER_ADMIN', 'ADMIN'],
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
  // Read-only capabilities are not writes.
  const READ_ONLY_CAPABILITIES = ['report.view', 'report.export']
  const writes = PERMISSIONS.filter((p) => !READ_ONLY_CAPABILITIES.includes(p))
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

/* --------------------------------------------------------------- approvals */
test('records created by Manager or Case Agent start PENDING; admins are auto-approved', async () => {
  const { initialApprovalStatus } = await import('../lib/authz')
  assert.equal(initialApprovalStatus('SUPER_ADMIN'), 'ACTIVE')
  assert.equal(initialApprovalStatus('ADMIN'), 'ACTIVE')
  assert.equal(initialApprovalStatus('MANAGER'), 'PENDING')
  assert.equal(initialApprovalStatus('CASE_AGENT'), 'PENDING')
  assert.equal(initialApprovalStatus('SALES_AGENT'), 'PENDING')
  assert.equal(initialApprovalStatus('nonsense'), 'PENDING', 'an unknown role must never auto-approve')
})

test('only Super Admin and Admin may approve or export', async () => {
  for (const role of ROLES) {
    const privileged = role === 'SUPER_ADMIN' || role === 'ADMIN'
    assert.equal(hasPermission(role, 'record.approve'), privileged, `${role} approve`)
    assert.equal(hasPermission(role, 'report.export'), privileged, `${role} export`)
    assert.equal(hasPermission(role, 'report.view'), true, `${role} should still view reports`)
  }
})

/* --------------------------------------------------------------- visibility */
test('only Super Admin, Admin and Manager see all records; others are scoped', async () => {
  const { seesAllRecords, isScopedToOwnWork } = await import('../lib/authz')
  for (const role of ROLES) {
    const full = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER'
    assert.equal(seesAllRecords(role), full, `${role} visibility`)
    assert.equal(isScopedToOwnWork(role), !full, `${role} scoping`)
  }
  assert.equal(seesAllRecords('nonsense'), false, 'an unknown role must never get full visibility')
})

/* ------------------------------------------------- role x visibility matrix */
test('full role x operational visibility x financial visibility matrix', async () => {
  const a = await import('../lib/authz')
  // [role, seesAllRecords, canSeeMoney, canSeeAllFinancialRecords,
  //  canSeeOperationalReports, canSeeFinancialReports, canAssignWorkToOthers]
  const EXPECTED: [string, boolean, boolean, boolean, boolean, boolean, boolean][] = [
    ['SUPER_ADMIN',    true,  true,  true,  true,  true,  true],
    ['ADMIN',          true,  true,  true,  true,  true,  true],
    ['MANAGER',        true,  true,  true,  true,  true,  true],
    ['BILLING',        false, true,  true,  false, true,  false],
    ['READ_ONLY',      false, true,  true,  false, true,  false],
    ['CASE_AGENT',     false, false, false, false, false, false],
    ['SALES_AGENT',    false, false, false, false, false, false],
    ['DOCUMENT_STAFF', false, false, false, false, false, false],
  ]
  for (const [role, seesAll, money, allMoney, opReports, finReports, assign] of EXPECTED) {
    assert.equal(a.seesAllRecords(role), seesAll, `${role} seesAllRecords`)
    assert.equal(a.canSeeMoney(role), money, `${role} canSeeMoney`)
    assert.equal(a.canSeeAllFinancialRecords(role), allMoney, `${role} canSeeAllFinancialRecords`)
    assert.equal(a.canSeeOperationalReports(role), opReports, `${role} canSeeOperationalReports`)
    assert.equal(a.canSeeFinancialReports(role), finReports, `${role} canSeeFinancialReports`)
    assert.equal(a.canAssignWorkToOthers(role), assign, `${role} canAssignWorkToOthers`)
    assert.equal(a.isScopedToOwnWork(role), !seesAll, `${role} isScopedToOwnWork`)
  }
  // Unknown roles must never gain anything.
  for (const fn of ['seesAllRecords','canSeeMoney','canSeeAllFinancialRecords','canSeeOperationalReports','canSeeFinancialReports','canAssignWorkToOthers'] as const) {
    assert.equal((a as unknown as Record<string, (r: string) => boolean>)[fn]('nonsense'), false, `nonsense ${fn}`)
  }
})

test('financial access never grants organisation-wide operational reports', async () => {
  const { canViewReportType } = await import('../lib/authz')
  const OPERATIONAL = ['status', 'agent', 'custagent', 'newcust', 'hearings']
  const FINANCIAL = ['method', 'outstanding']

  for (const role of ['BILLING', 'READ_ONLY']) {
    for (const r of OPERATIONAL) assert.equal(canViewReportType(role, r), false, `${role} must not see ${r}`)
    for (const r of FINANCIAL) assert.equal(canViewReportType(role, r), true, `${role} should see ${r}`)
  }
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER']) {
    for (const r of [...OPERATIONAL, ...FINANCIAL]) assert.equal(canViewReportType(role, r), true, `${role} ${r}`)
  }
  for (const r of [...OPERATIONAL, ...FINANCIAL]) {
    assert.equal(canViewReportType('CASE_AGENT', r), false, `CASE_AGENT must not see ${r}`)
  }
})

/* ------------------------------------------------- task assignee policy */
test('TASK_ASSIGNEE_ROLES includes working roles and excludes READ_ONLY', async () => {
  const { isTaskAssignableRole } = await import('../lib/authz')
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASE_AGENT', 'SALES_AGENT', 'BILLING', 'DOCUMENT_STAFF']) {
    assert.equal(isTaskAssignableRole(role), true, `${role} must be able to receive tasks`)
  }
  assert.equal(isTaskAssignableRole('READ_ONLY'), false, 'READ_ONLY holds no write permission and must be excluded')
  assert.equal(isTaskAssignableRole('nonsense'), false)
})

test('report types are an explicit allowlist', async () => {
  const { isReportType, REPORT_TYPES } = await import('../lib/authz')
  for (const r of REPORT_TYPES) assert.equal(isReportType(r), true, `${r} must be recognised`)
  for (const bad of ['', 'drop', 'status; select 1', 'unknown', 42, null]) {
    assert.equal(isReportType(bad), false, `${String(bad)} must be rejected`)
  }
})

/* ---------------------------------- non-financial case list never sees money */
test('the non-financial customer-case query selects no fee, payments or totals', async () => {
  const { CASE_LIST_SQL } = await import('../lib/customer-cases')
  const nf = CASE_LIST_SQL.nonFinancial.toLowerCase()
  for (const token of ['fee', 'payments', 'paid', 'sum(', 'amount', 'outstanding']) {
    assert.ok(!nf.includes(token), `the non-financial query must not reference "${token}"`)
  }
  // The financial branch is the only one that may.
  const fin = CASE_LIST_SQL.financial.toLowerCase()
  assert.ok(fin.includes('k.fee') && fin.includes('payments'), 'the financial branch still loads money')
})

test('loadCustomerCases issues the non-financial query when showMoney is false', async () => {
  const { loadCustomerCases } = await import('../lib/customer-cases')
  const seen: string[] = []
  // A fake tagged-template client records the SQL actually issued.
  const fakeSql = ((strings: TemplateStringsArray) => {
    seen.push(strings.join(' ? ').toLowerCase())
    return Promise.resolve([])
  }) as unknown as Parameters<typeof loadCustomerCases>[0]

  await loadCustomerCases(fakeSql, 'cust-1', 'user-1', true, false)
  assert.equal(seen.length, 1)
  for (const token of ['fee', 'payments', 'sum(', 'amount']) {
    assert.ok(!seen[0].includes(token), `non-financial path must not issue SQL containing "${token}"`)
  }

  seen.length = 0
  await loadCustomerCases(fakeSql, 'cust-1', 'user-1', true, true)
  assert.ok(seen[0].includes('fee') && seen[0].includes('payments'), 'financial path still loads money')
})

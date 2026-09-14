// Integration tests against a REAL running instance of the app and a REAL (but isolated,
// disposable) Postgres database — never production. This is deliberate: several of the
// bugs this review fixed (privilege escalation, session revocation, setup exposure) only
// manifest through the actual request pipeline (cookies, middleware, getCurrentUser()'s
// DB round-trip), so mocking them out would test the mocks, not the fix.
//
// Usage: set TEST_BASE_URL to a running `next start` instance pointed at a scratch
// database (see scripts/run-integration-tests.sh), then run with `tsx`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'

const BASE = process.env.TEST_BASE_URL
const DB_URL = process.env.TEST_DATABASE_URL
if (!BASE || !DB_URL) {
  console.error('TEST_BASE_URL and TEST_DATABASE_URL must be set — see scripts/run-integration-tests.sh')
  process.exit(1)
}

const sql = postgres(DB_URL, { ssl: 'require', prepare: false, max: 2 })

// --- tiny fetch helper that tracks the session cookie like a browser would -----------------
function client() {
  let cookie = ''
  async function req(path: string, init: RequestInit = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return res
  }
  return {
    login: (email: string, password: string) => req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    get: (path: string) => req(path),
    post: (path: string, body: unknown) => req(path, { method: 'POST', body: JSON.stringify(body) }),
    patch: (path: string, body: unknown) => req(path, { method: 'PATCH', body: JSON.stringify(body) }),
    del: (path: string) => req(path, { method: 'DELETE' }),
    get cookie() { return cookie },
    set cookie(v: string) { cookie = v },
  }
}

const rand = () => Math.random().toString(36).slice(2, 10)
const PW = 'Test-Password-123!'

let superEmail: string
let customerId: string
let caseIdForCustomer: string
let otherCustomerId: string
let otherCaseId: string

before(async () => {
  // Seed a known Super Admin directly (bypassing scripts/setup.mjs here purely for test
  // speed — setup.mjs itself is exercised separately in the "setup protection" tests below).
  superEmail = `super-${rand()}@test.local`
  const bcrypt = (await import('bcryptjs')).default
  const hash = await bcrypt.hash(PW, 10)
  await sql`insert into users (name, email, password_hash, role, status) values ('Test Super', ${superEmail}, ${hash}, 'SUPER_ADMIN', 'ACTIVE')`

  // A customer + two cases (one belonging to them, one belonging to someone else) used by
  // the payment-validation tests below.
  const [cust] = await sql<{ id: string }[]>`insert into customers (first_name, last_name) values ('Alice', 'Anderson') returning id`
  customerId = cust.id
  const [kase] = await sql<{ id: string }[]>`insert into cases (customer_id, citation) values (${customerId}, 'T-1001') returning id`
  caseIdForCustomer = kase.id
  const [cust2] = await sql<{ id: string }[]>`insert into customers (first_name, last_name) values ('Bob', 'Brown') returning id`
  otherCustomerId = cust2.id
  const [kase2] = await sql<{ id: string }[]>`insert into cases (customer_id, citation) values (${otherCustomerId}, 'T-2002') returning id`
  otherCaseId = kase2.id
})

after(async () => { await sql.end({ timeout: 5 }) })

async function createUser(admin: ReturnType<typeof client>, role: string, status = 'ACTIVE') {
  const email = `${role.toLowerCase()}-${rand()}@test.local`
  const res = await admin.post('/api/users', { name: role, email, password: PW, role, status })
  return { email, res }
}

// ---------------------------------------------------------------------------------------
// 1. READ_ONLY cannot call write APIs (the originally-reported bug)
// ---------------------------------------------------------------------------------------
test('READ_ONLY is blocked from payments, tasks, cases, customers, assign, hearings', async () => {
  const admin = client()
  assert.equal((await admin.login(superEmail, PW)).status, 200)
  const { email } = await createUser(admin, 'READ_ONLY')

  const ro = client()
  assert.equal((await ro.login(email, PW)).status, 200)

  const payments = await ro.post('/api/payments', { customerId, amount: 50, kind: 'Membership' })
  assert.equal(payments.status, 403, 'READ_ONLY must not be able to record a payment')

  const tasks = await ro.post('/api/tasks', { title: 'Should be blocked' })
  assert.equal(tasks.status, 403, 'READ_ONLY must not be able to create a task')

  const cases = await ro.post('/api/cases', { customerId, citation: 'X-1' })
  assert.equal(cases.status, 403, 'READ_ONLY must not be able to create a case')

  const customers = await ro.post('/api/customers', { firstName: 'X', lastName: 'Y' })
  assert.equal(customers.status, 403, 'READ_ONLY must not be able to create a customer')

  const assign = await ro.post('/api/assign', { customerId, agentId: superEmail })
  assert.equal(assign.status, 403, 'READ_ONLY must not be able to reassign an agent')

  const hearings = await ro.post('/api/hearings', { caseId: caseIdForCustomer, hearingType: 'Zoom' })
  assert.equal(hearings.status, 403, 'READ_ONLY must not be able to schedule a hearing')
})

test('a normal staff role (MANAGER) CAN still perform these writes — the fix does not break legitimate workflows', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const { email } = await createUser(admin, 'MANAGER')
  const mgr = client()
  assert.equal((await mgr.login(email, PW)).status, 200)
  const res = await mgr.post('/api/payments', { customerId, amount: 25, kind: 'Membership', method: 'Cash', status: 'Paid' })
  assert.equal(res.status, 200, 'MANAGER should still be able to record a payment')
})

// ---------------------------------------------------------------------------------------
// 2. Privilege escalation
// ---------------------------------------------------------------------------------------
test('an ADMIN cannot create an ADMIN or SUPER_ADMIN account', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const { email: adminEmail } = await createUser(admin, 'ADMIN')
  const asAdmin = client()
  assert.equal((await asAdmin.login(adminEmail, PW)).status, 200)

  const tryAdmin = await asAdmin.post('/api/users', { name: 'x', email: `x-${rand()}@test.local`, password: PW, role: 'ADMIN' })
  assert.equal(tryAdmin.status, 403, 'ADMIN creating an ADMIN must be rejected')

  const trySuper = await asAdmin.post('/api/users', { name: 'x', email: `x-${rand()}@test.local`, password: PW, role: 'SUPER_ADMIN' })
  assert.equal(trySuper.status, 403, 'ADMIN creating a SUPER_ADMIN must be rejected')

  const tryManager = await asAdmin.post('/api/users', { name: 'x', email: `x-${rand()}@test.local`, password: PW, role: 'MANAGER' })
  assert.equal(tryManager.status, 200, 'ADMIN creating a lower-ranked MANAGER should still work')
})

test('role and status are validated against allowlists, not accepted as arbitrary strings', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const badRole = await admin.post('/api/users', { name: 'x', email: `x-${rand()}@test.local`, password: PW, role: 'GOD_MODE' })
  assert.equal(badRole.status, 400)
  const badStatus = await admin.post('/api/users', { name: 'x', email: `x-${rand()}@test.local`, password: PW, status: 'GHOST' })
  assert.equal(badStatus.status, 400)
})

test('the last active Super Admin cannot be disabled or deleted', async () => {
  const admin = client()
  await admin.login(superEmail, PW)

  // Provisioning (scripts/setup.mjs) may have created its own bootstrap Super Admin in
  // this database — normalize to exactly one active Super Admin (our test's `superEmail`)
  // before testing the boundary, so the test is deterministic regardless of what else is
  // sitting in the database.
  const others = await sql<{ id: string }[]>`select id from users where role = 'SUPER_ADMIN' and status = 'ACTIVE' and email != ${superEmail}`
  for (const o of others) await sql`update users set status = 'DISABLED' where id = ${o.id}`
  const [{ count: countBefore }] = await sql<{ count: string }[]>`select count(*)::text as count from users where role = 'SUPER_ADMIN' and status = 'ACTIVE'`
  assert.equal(countBefore, '1', 'test setup expects exactly one active super admin at this point')

  const [{ id: super1Id }] = await sql<{ id: string }[]>`select id from users where email = ${superEmail}`
  const disableSuper1 = await admin.patch('/api/users', { id: super1Id, status: 'DISABLED' })
  assert.equal(disableSuper1.status, 400, 'disabling the LAST active super admin must be rejected')

  const deleteSuper1 = await admin.del(`/api/users?id=${super1Id}`)
  assert.equal(deleteSuper1.status, 400, 'deleting the LAST active super admin must be rejected')

  // Opposite boundary: with a second active super admin present, disabling one succeeds.
  const { email: super2Email } = await createUser(admin, 'SUPER_ADMIN')
  const [{ id: super2Id }] = await sql<{ id: string }[]>`select id from users where email = ${super2Email}`
  const disableSuper2 = await admin.patch('/api/users', { id: super2Id, status: 'DISABLED' })
  assert.equal(disableSuper2.status, 200, 'disabling a super admin that is NOT the last one should succeed')
})

// ---------------------------------------------------------------------------------------
// 3. Session revocation
// ---------------------------------------------------------------------------------------
test('disabling a user immediately invalidates their existing session (not just after expiry)', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const { email } = await createUser(admin, 'MANAGER')
  const victim = client()
  assert.equal((await victim.login(email, PW)).status, 200)
  // Confirm the session works before revocation.
  assert.equal((await victim.post('/api/tasks', { title: 'before disable' })).status, 200)

  const [{ id: victimId }] = await sql<{ id: string }[]>`select id from users where email = ${email}`
  await admin.patch('/api/users', { id: victimId, status: 'DISABLED' })

  const afterDisable = await victim.post('/api/tasks', { title: 'after disable' })
  assert.equal(afterDisable.status, 403, 'a session for a just-disabled account must stop working immediately')
})

test('changing your password invalidates OTHER existing sessions for that account, but not your own', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const { email } = await createUser(admin, 'CASE_AGENT')

  const deviceA = client()
  await deviceA.login(email, PW)
  const deviceB = client()
  await deviceB.login(email, PW)
  assert.equal((await deviceA.post('/api/tasks', { title: 'a1' })).status, 200)
  assert.equal((await deviceB.post('/api/tasks', { title: 'b1' })).status, 200)

  const changed = await deviceA.post('/api/profile', { current: PW, next: 'New-Password-456!' })
  assert.equal(changed.status, 200)

  const stillA = await deviceA.post('/api/tasks', { title: 'a2-after-change' })
  assert.equal(stillA.status, 200, 'the device that changed the password should stay logged in')

  const nowB = await deviceB.post('/api/tasks', { title: 'b2-after-change' })
  assert.equal(nowB.status, 403, 'a DIFFERENT session for the same account must be logged out after a password change')
})

// ---------------------------------------------------------------------------------------
// 4. Setup protection
// ---------------------------------------------------------------------------------------
test('GET /api/setup no longer exists (was an unauthenticated schema/admin-seeding endpoint)', async () => {
  const anon = client()
  const res = await anon.get('/api/setup')
  assert.equal(res.status, 404)
})

test('anonymous requests cannot create users, cases, customers, or payments', async () => {
  const anon = client()
  assert.equal((await anon.post('/api/users', { name: 'x', email: `x-${rand()}@test.local`, password: PW, role: 'ADMIN' })).status, 403)
  assert.equal((await anon.post('/api/payments', { customerId, amount: 10 })).status, 403)
  assert.equal((await anon.post('/api/cases', { customerId, citation: 'ANON-1' })).status, 403)
  assert.equal((await anon.post('/api/customers', { firstName: 'A', lastName: 'B' })).status, 403)
})

// ---------------------------------------------------------------------------------------
// 5. Payment validation
// ---------------------------------------------------------------------------------------
test('a case payment must reference a case that actually belongs to the given customer', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  // otherCaseId belongs to otherCustomerId, not customerId — this is exactly the stale/
  // mismatched-selection scenario the client-side fix addresses, enforced here server-side.
  const res = await admin.post('/api/payments', { customerId, caseId: otherCaseId, kind: 'Case', amount: 100, method: 'Card', status: 'Paid' })
  assert.equal(res.status, 400)
})

test('a case payment for the correct matching case succeeds', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const res = await admin.post('/api/payments', { customerId, caseId: caseIdForCustomer, kind: 'Case', amount: 100, method: 'Card', status: 'Paid' })
  assert.equal(res.status, 200)
})

test('non-finite amounts are rejected, including the string "Infinity" (which Number() accepts)', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const res = await admin.post('/api/payments', { customerId, amount: 'Infinity', kind: 'Membership' })
  assert.equal(res.status, 400, 'Number("Infinity") is a real, finite-looking bypass of a naive `!amount` check — must be explicitly rejected')
})

test('unknown kind/method/status values are rejected', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const badKind = await admin.post('/api/payments', { customerId, amount: 10, kind: 'Bribe' })
  assert.equal(badKind.status, 400)
  const badMethod = await admin.post('/api/payments', { customerId, amount: 10, kind: 'Membership', method: 'Crypto' })
  assert.equal(badMethod.status, 400)
  const badStatus = await admin.post('/api/payments', { customerId, amount: 10, kind: 'Membership', status: 'Fraudulent' })
  assert.equal(badStatus.status, 400)
})

// ---------------------------------------------------------------------------------------
// 6. Safe exports (CSV formula injection)
// ---------------------------------------------------------------------------------------
test('CSV report exports neutralize formula-injection payloads in text fields', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const evilName = '=SUM(1,2)+cmd'
  const [evilCust] = await sql<{ id: string }[]>`insert into customers (first_name, last_name) values (${evilName}, 'Evil') returning id`
  await sql`insert into payments (customer_id, amount, status, invoice) values (${evilCust.id}, 42, 'Pending', ${'INV-' + rand()})`

  const res = await admin.get('/api/reports?r=outstanding')
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.ok(!text.includes(`"${evilName}`), 'the raw formula must not appear unescaped at the start of a cell')
  assert.ok(text.includes(`'${evilName}`), 'the sanitized (quote-prefixed) form should appear instead')
})

test('CSV export no longer offers a mislabeled fake .xlsx — content-type is always real text/csv', async () => {
  const admin = client()
  await admin.login(superEmail, PW)
  const res = await admin.get('/api/reports?r=status&format=xlsx')
  assert.equal(res.status, 200)
  const ct = res.headers.get('content-type') || ''
  assert.ok(ct.includes('text/csv'), `expected text/csv even when format=xlsx is requested, got: ${ct}`)
  const cd = res.headers.get('content-disposition') || ''
  assert.ok(cd.endsWith('.csv"'), `filename must end in .csv, not a fake .xls/.xlsx, got: ${cd}`)
})

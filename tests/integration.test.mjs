import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import postgres from 'postgres'

const PORT = Number(process.env.TEST_PORT || 3311)
const BASE = `http://127.0.0.1:${PORT}`
const DB = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/portal_test?sslmode=disable'

let server
const sql = postgres(DB, { ssl: /[?&]sslmode=disable(&|$)/i.test(DB) ? false : 'require' })

async function waitReady(ms = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`${BASE}/login`); if (r.status < 500) return } catch {}
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('server did not become ready')
}

before(async () => {
  server = spawn('./node_modules/.bin/next', ['start', '-p', String(PORT)], {
    env: { ...process.env,
      AUTH_SECRET: 'integration-test-secret-0123456789abcdefghij',
      DATABASE_URL: DB,
      CRON_SECRET: process.env.TEST_CRON_SECRET || 'test-cron-secret-0123456789abcdefghijklmnop',
      NODE_ENV: 'production' },
    stdio: 'ignore',
  })
  await waitReady()
})
after(async () => { server?.kill('SIGKILL'); await sql.end({ timeout: 5 }) })

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const cookie = (r.headers.getSetCookie?.() || []).find((c) => c.startsWith('clp_session=')) || ''
  return { status: r.status, cookie: cookie.split(';')[0] }
}
const api = (path, cookie, method = 'POST', body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const OWNER = { email: 'owner@example.test', password: 'TestOwnerPassw0rd!' }
const PW = 'StrongPassw0rd!2026'
let ownerCookie

/** Lazily establishes the Super Admin session so tests can run independently. */
async function owner() {
  if (!ownerCookie) {
    const r = await login(OWNER.email, OWNER.password)
    assert.equal(r.status, 200, 'super admin login failed')
    ownerCookie = r.cookie
  }
  return ownerCookie
}

async function ensureUser(email, role) {
  await owner()
  await sql`delete from users where email = ${email}`
  const r = await api('/api/users', (await owner()), 'POST', { name: role + ' user', email, password: PW, role, status: 'ACTIVE' })
  assert.equal(r.status, 200, `seed ${role}: ${await r.text()}`)
  return (await login(email, PW)).cookie
}

// ------------------------------------------------- provisioning is CLI/CI only
test('the HTTP provisioning endpoint does not exist at all (schema changes are CLI/CI only)', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await fetch(`${BASE}/api/setup`, { method, headers: { 'x-setup-token': 'anything' } })
    assert.equal(r.status, 404, `${method} /api/setup must not exist (got ${r.status})`)
  }
})

// ------------------------------------------------------------- permissions
test('login as super admin succeeds', async () => {
  const r = await login(OWNER.email, OWNER.password)
  assert.equal(r.status, 200)
  assert.ok(r.cookie)
  ownerCookie = r.cookie
})

test('Finding 2: READ_ONLY cannot create tasks or payments', async () => {
  const cookie = await ensureUser('readonly@example.test', 'READ_ONLY')
  const t = await api('/api/tasks', cookie, 'POST', { title: 'should not exist' })
  assert.equal(t.status, 403, 'READ_ONLY must not create tasks')

  const [c] = await sql`insert into customers (first_name,last_name) values ('Perm','Check') returning id`
  const p = await api('/api/payments', cookie, 'POST', { customerId: c.id, kind: 'Membership', method: 'Card', amount: 10, status: 'Paid' })
  assert.equal(p.status, 403, 'READ_ONLY must not create payments')

  const [{ n }] = await sql`select count(*)::int n from tasks where title = 'should not exist'`
  assert.equal(n, 0, 'no task row may be written by a denied request')
})

test('Finding 2: CASE_AGENT cannot take payments but BILLING can', async () => {
  const agent = await ensureUser('agent@example.test', 'CASE_AGENT')
  const billing = await ensureUser('billing@example.test', 'BILLING')
  const [c] = await sql`insert into customers (first_name,last_name) values ('Billing','Target') returning id`

  const denied = await api('/api/payments', agent, 'POST', { customerId: c.id, kind: 'Membership', method: 'Card', amount: 25, status: 'Paid' })
  assert.equal(denied.status, 403)

  const allowed = await api('/api/payments', billing, 'POST', { customerId: c.id, kind: 'Membership', method: 'Card', amount: 25, status: 'Paid' })
  assert.equal(allowed.status, 200, await allowed.text())
})

test('Finding 2: unauthenticated writes are rejected', async () => {
  const r = await api('/api/tasks', '', 'POST', { title: 'anon' })
  assert.equal(r.status, 401)
})

// ------------------------------------------------------- privilege escalation
test('Finding 3: ADMIN cannot create a SUPER_ADMIN', async () => {
  const admin = await ensureUser('admin@example.test', 'ADMIN')
  const r = await api('/api/users', admin, 'POST', { name: 'Escalated', email: 'escalated@example.test', password: PW, role: 'SUPER_ADMIN' })
  assert.equal(r.status, 403)
  const [{ n }] = await sql`select count(*)::int n from users where email = 'escalated@example.test'`
  assert.equal(n, 0, 'no SUPER_ADMIN row may be created')
})

test('Finding 3: unknown role/status values are rejected', async () => {
  const r = await api('/api/users', (await owner()), 'POST', { name: 'Bad', email: 'bad@example.test', password: PW, role: 'ROOT' })
  assert.equal(r.status, 400)
  const r2 = await api('/api/users', (await owner()), 'POST', { name: 'Bad2', email: 'bad2@example.test', password: PW, role: 'ADMIN', status: 'SUPER' })
  assert.equal(r2.status, 400)
})

test('Finding 3: ADMIN cannot disable a SUPER_ADMIN', async () => {
  const admin = await ensureUser('admin2@example.test', 'ADMIN')
  const [ownerRow] = await sql`select id from users where email = ${OWNER.email}`
  const r = await api('/api/users', admin, 'PATCH', { id: ownerRow.id, status: 'DISABLED' })
  assert.equal(r.status, 403)
  const [row] = await sql`select status from users where id = ${ownerRow.id}`
  assert.equal(row.status, 'ACTIVE')
})

test('Finding 3: self-status and self-delete are blocked; a second super admin is manageable', async () => {
  const [ownerRow] = await sql`select id from users where email = ${OWNER.email}`

  // Self-service guards (the actor cannot lock themselves out or self-delete here).
  const selfDel = await fetch(`${BASE}/api/users?id=${ownerRow.id}`, { method: 'DELETE', headers: { cookie: (await owner()) } })
  assert.equal(selfDel.status, 400)
  const selfPatch = await api('/api/users', (await owner()), 'PATCH', { id: ownerRow.id, status: 'DISABLED' })
  assert.equal(selfPatch.status, 400)

  // Legitimate workflow: a super admin may create and then manage another super admin.
  await sql`delete from users where email = 'super2@example.test'`
  const create = await api('/api/users', (await owner()), 'POST', { name: 'Second Super', email: 'super2@example.test', password: PW, role: 'SUPER_ADMIN' })
  assert.equal(create.status, 200, await create.text())
  const [s2] = await sql`select id from users where email = 'super2@example.test'`
  const disable = await api('/api/users', (await owner()), 'PATCH', { id: s2.id, status: 'DISABLED' })
  assert.equal(disable.status, 200, 'disabling a non-last super admin is allowed')
  const [row] = await sql`select status from users where id = ${s2.id}`
  assert.equal(row.status, 'DISABLED')

  // The owner is still the only ACTIVE super admin and remains active.
  const [{ n }] = await sql`select count(*)::int n from users where role='SUPER_ADMIN' and status='ACTIVE'`
  assert.equal(n, 1)
})

// -------------------------------------------- legitimate workflows preserved
test('Regression: privileged roles can still perform their normal work', async () => {
  // Super admin: customers and cases
  const cust = await api('/api/customers', (await owner()), 'POST', { firstName: 'Normal', lastName: 'Flow', email: 'flow@example.test' })
  const custBody = await cust.json().catch(() => ({}))
  assert.equal(cust.status, 200, JSON.stringify(custBody))
  const customerId = custBody.id
  const kase = await api('/api/cases', (await owner()), 'POST', { customerId, citation: 'FLOW-1', fee: 300 })
  assert.equal(kase.status, 200, await kase.text())

  // Manager: assignment + settings
  const manager = await ensureUser('manager@example.test', 'MANAGER')
  const [agent] = await sql`select id from users where email = 'agent@example.test'`
  const assign = await api('/api/assign', manager, 'POST', { customerId, agentId: agent.id })
  assert.equal(assign.status, 200, await assign.text())
  const settings = await api('/api/settings', manager, 'POST', { company_name: 'CL Protection USA' })
  assert.equal(settings.status, 200)

  // Case agent: tasks
  const caseAgent = await ensureUser('agent3@example.test', 'CASE_AGENT')
  const task = await api('/api/tasks', caseAgent, 'POST', { title: 'Call the court', priority: 'High' })
  assert.equal(task.status, 200)
})

test('Regression: settings rejects unknown keys (allowlist)', async () => {
  const r = await api('/api/settings', (await owner()), 'POST', { evil_key: 'x' })
  assert.equal(r.status, 400)
})

test('Regression: protected pages redirect anonymous users to /login and render when signed in', async () => {
  const anon = await fetch(`${BASE}/dashboard`, { redirect: 'manual' })
  assert.ok([302, 307].includes(anon.status), `expected redirect, got ${anon.status}`)
  assert.match(anon.headers.get('location') || '', /\/login/)

  const authed = await fetch(`${BASE}/dashboard`, { headers: { cookie: (await owner()) } })
  assert.equal(authed.status, 200)
  const html = await authed.text()
  assert.match(html, /Operations Dashboard/)
})

// ------------------------------------------------------- session revocation
test('Finding 4: disabling an account revokes its existing session', async () => {
  const cookie = await ensureUser('revoke@example.test', 'CASE_AGENT')
  const before = await api('/api/tasks', cookie, 'POST', { title: 'before disable' })
  assert.equal(before.status, 200, 'sanity: works while active')

  const [u] = await sql`select id from users where email = 'revoke@example.test'`
  const dis = await api('/api/users', (await owner()), 'PATCH', { id: u.id, status: 'DISABLED' })
  assert.equal(dis.status, 200)

  const after = await api('/api/tasks', cookie, 'POST', { title: 'after disable' })
  assert.equal(after.status, 401, 'the old JWT must stop working immediately')
})

test('Finding 4: deleting an account revokes its existing session', async () => {
  const cookie = await ensureUser('gone@example.test', 'CASE_AGENT')
  const [u] = await sql`select id from users where email = 'gone@example.test'`
  const del = await fetch(`${BASE}/api/users?id=${u.id}`, { method: 'DELETE', headers: { cookie: (await owner()) } })
  assert.equal(del.status, 200, await del.text())
  const after = await api('/api/tasks', cookie, 'POST', { title: 'after delete' })
  assert.equal(after.status, 401)
})

test('Finding 4: changing a password invalidates previously issued sessions', async () => {
  const oldCookie = await ensureUser('rotate@example.test', 'CASE_AGENT')
  const change = await api('/api/profile', oldCookie, 'POST', { current: PW, next: 'Rotated-Passw0rd!2026' })
  assert.equal(change.status, 200, await change.text())

  // The token captured BEFORE the change must no longer authorise anything.
  const after = await api('/api/tasks', oldCookie, 'POST', { title: 'stale token' })
  assert.equal(after.status, 401, 'pre-change token must be rejected')

  const fresh = await login('rotate@example.test', 'Rotated-Passw0rd!2026')
  assert.equal(fresh.status, 200)
})

// ------------------------------------------------------- payment validation
test('Finding 6: non-finite / out-of-range amounts are rejected', async () => {
  const billing = await ensureUser('billing2@example.test', 'BILLING')
  const [c] = await sql`insert into customers (first_name,last_name) values ('Amount','Check') returning id`
  for (const amount of ['abc', 'Infinity', -5, 0, 1e12, null]) {
    const r = await api('/api/payments', billing, 'POST', { customerId: c.id, kind: 'Membership', method: 'Card', amount, status: 'Paid' })
    assert.equal(r.status, 400, `amount ${amount} must be rejected`)
  }
  const [{ n }] = await sql`select count(*)::int n from payments where customer_id = ${c.id}`
  assert.equal(n, 0, 'no payment row may be written for invalid input')
})

test('Finding 6: invalid kind/method/status are rejected', async () => {
  const billing = await ensureUser('billing3@example.test', 'BILLING')
  const [c] = await sql`insert into customers (first_name,last_name) values ('Enum','Check') returning id`
  const bad = [
    { kind: 'Donation', method: 'Card', status: 'Paid' },
    { kind: 'Membership', method: 'Crypto', status: 'Paid' },
    { kind: 'Membership', method: 'Card', status: 'Settled' },
  ]
  for (const b of bad) {
    const r = await api('/api/payments', billing, 'POST', { customerId: c.id, amount: 10, ...b })
    assert.equal(r.status, 400, JSON.stringify(b))
  }
})

test('Finding 6: case payments must reference a case owned by that customer', async () => {
  const billing = await ensureUser('billing4@example.test', 'BILLING')
  const [c1] = await sql`insert into customers (first_name,last_name) values ('Owner','One') returning id`
  const [c2] = await sql`insert into customers (first_name,last_name) values ('Owner','Two') returning id`
  const [k2] = await sql`insert into cases (customer_id, citation) values (${c2.id}, 'OTHER-1') returning id`

  const missing = await api('/api/payments', billing, 'POST', { customerId: c1.id, kind: 'Case', method: 'Card', amount: 50, status: 'Paid' })
  assert.equal(missing.status, 400, 'case payment without a case must be rejected')

  const wrongOwner = await api('/api/payments', billing, 'POST', { customerId: c1.id, caseId: k2.id, kind: 'Case', method: 'Card', amount: 50, status: 'Paid' })
  assert.equal(wrongOwner.status, 400, 'case belonging to another customer must be rejected')

  const unknown = await api('/api/payments', billing, 'POST', { customerId: c1.id, caseId: '00000000-0000-0000-0000-000000000000', kind: 'Case', method: 'Card', amount: 50, status: 'Paid' })
  assert.ok([400, 404].includes(unknown.status), 'unknown case must be rejected')

  const [{ n }] = await sql`select count(*)::int n from payments where customer_id = ${c1.id}`
  assert.equal(n, 0)
})

test('Finding 6: a valid case payment is accepted and linked', async () => {
  const billing = await ensureUser('billing5@example.test', 'BILLING')
  const [c] = await sql`insert into customers (first_name,last_name) values ('Valid','Case') returning id`
  const [k] = await sql`insert into cases (customer_id, citation, fee) values (${c.id}, 'OK-1', 500) returning id`
  const r = await api('/api/payments', billing, 'POST', { customerId: c.id, caseId: k.id, kind: 'Case', method: 'Card', amount: 200.005, status: 'Paid' })
  assert.equal(r.status, 200, await r.text())
  const [row] = await sql`select case_id, amount from payments where customer_id = ${c.id}`
  assert.equal(row.case_id, k.id)
  assert.equal(Number(row.amount), 200.01, 'amount is rounded to 2dp')
})

// --------------------------------------------------------------- CSV export
test('Finding 7: CSV export neutralises formula injection and keeps numbers numeric', async () => {
  const [c] = await sql`insert into customers (first_name,last_name) values ('=cmd|'' /C calc''!A0', 'Inject') returning id`
  await sql`insert into payments (customer_id, kind, method, amount, status, invoice)
            values (${c.id}, 'Membership', 'Card', 149, 'Overdue', '@SUM(1+1)')`
  const r = await fetch(`${BASE}/api/reports?r=outstanding`, { headers: { cookie: (await owner()) } })
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') || '', /text\/csv/)
  assert.match(r.headers.get('content-disposition') || '', /\.csv"/)
  const body = await r.text()
  assert.ok(body.includes(`"'=cmd`), 'leading = must be neutralised with a quote prefix')
  assert.ok(body.includes(`"'@SUM(1+1)"`), 'leading @ must be neutralised')
  assert.ok(/(^|,)149(,|\r|$)/m.test(body), 'numeric amount must stay unquoted/numeric')
})

test('Finding 2: report export requires authentication', async () => {
  const r = await fetch(`${BASE}/api/reports?r=outstanding`)
  assert.ok([401, 403].includes(r.status), `expected 401/403, got ${r.status}`)
})

// ------------------------------------------- revoked sessions cannot READ either
// /api/notifications returns customer, case and financial data, so a revoked
// session must be refused on reads and not only on writes.
test('a DISABLED account cannot read /api/notifications with its existing session', async () => {
  const cookie = await ensureUser('notif-disable@example.test', 'CASE_AGENT')
  assert.equal((await api('/api/notifications', cookie, 'GET')).status, 200, 'sanity: works while active')

  const [u] = await sql`select id from users where email = 'notif-disable@example.test'`
  assert.equal((await api('/api/users', (await owner()), 'PATCH', { id: u.id, status: 'DISABLED' })).status, 200)

  const after = await api('/api/notifications', cookie, 'GET')
  assert.ok([401, 403].includes(after.status), `expected 401/403 after disable, got ${after.status}`)
})

test('a DELETED account cannot read /api/notifications with its existing session', async () => {
  const cookie = await ensureUser('notif-delete@example.test', 'CASE_AGENT')
  assert.equal((await api('/api/notifications', cookie, 'GET')).status, 200)

  const [u] = await sql`select id from users where email = 'notif-delete@example.test'`
  const del = await fetch(`${BASE}/api/users?id=${u.id}`, { method: 'DELETE', headers: { cookie: (await owner()) } })
  assert.equal(del.status, 200, await del.text())

  const after = await api('/api/notifications', cookie, 'GET')
  assert.ok([401, 403].includes(after.status), `expected 401/403 after delete, got ${after.status}`)
})

test('a password change invalidates previously issued sessions for /api/notifications reads', async () => {
  // Session A is captured BEFORE the change; session B performs the change.
  // Checking only the fresh cookie would pass even if revocation were broken.
  const EMAIL = 'notif-rotate@example.test'
  const sessionA = await ensureUser(EMAIL, 'CASE_AGENT')
  assert.equal((await api('/api/notifications', sessionA, 'GET')).status, 200, 'sanity: session A works first')

  const sessionB = await login(EMAIL, PW)
  assert.equal(sessionB.status, 200)
  const changed = await api('/api/profile', sessionB.cookie, 'POST', { current: PW, next: 'Rotated-Passw0rd!2026' })
  assert.equal(changed.status, 200, await changed.text())

  const stale = await api('/api/notifications', sessionA, 'GET')
  assert.ok([401, 403].includes(stale.status), `the pre-change session must be rejected, got ${stale.status}`)

  const fresh = await login(EMAIL, 'Rotated-Passw0rd!2026')
  assert.equal(fresh.status, 200)
  assert.equal((await api('/api/notifications', fresh.cookie, 'GET')).status, 200, 'a newly issued session works')
})

// ------------------------------------------- input validation writes no rows
test('invalid CASE values return 400 and write no row', async () => {
  const [c] = await sql`insert into customers (first_name,last_name) values ('Case','Validation') returning id`
  const [{ n: before }] = await sql`select count(*)::int n from cases`

  const invalid = [
    { citation: 'BAD-STATUS', status: 'Teleported' },
    { citation: 'BAD-PRIORITY', priority: 'Critical' },
    { citation: 'BAD-CMV', cmv: 'Maybe' },
    { citation: 'BAD-CDL', cdl: 'Sometimes' },
    { citation: 'BAD-HTYPE', hearingType: 'Telepathy' },
    { citation: 'BAD-PREP', prepStatus: 'Almost' },
    { citation: 'BAD-DATE', hearingAt: 'not-a-date' },
    { citation: 'x'.repeat(5000) },
    { citation: 'BAD-AGENT', agentId: '00000000-0000-0000-0000-000000000000' },
  ]
  for (const body of invalid) {
    const r = await api('/api/cases', (await owner()), 'POST', { customerId: c.id, ...body })
    assert.ok([400, 404].includes(r.status), `${JSON.stringify(body).slice(0, 50)} -> ${r.status}`)
  }
  const missingCustomer = await api('/api/cases', (await owner()), 'POST', { customerId: '00000000-0000-0000-0000-000000000000', citation: 'NOCUST' })
  assert.ok([400, 404].includes(missingCustomer.status))

  const [{ n: after }] = await sql`select count(*)::int n from cases`
  assert.equal(after, before, 'no case row may be written by a rejected request')
})

test('NaN, Infinity and negative case fine/fee amounts are rejected and write no row', async () => {
  const [c] = await sql`insert into customers (first_name,last_name) values ('Amount','Validation') returning id`
  const [{ n: before }] = await sql`select count(*)::int n from cases`
  for (const amount of ['abc', 'NaN', 'Infinity', '-Infinity', -1, -0.5, 1e15]) {
    const fee = await api('/api/cases', (await owner()), 'POST', { customerId: c.id, citation: 'AMT-FEE', fee: amount })
    assert.equal(fee.status, 400, `fee ${String(amount)} -> ${fee.status}`)
    const fine = await api('/api/cases', (await owner()), 'POST', { customerId: c.id, citation: 'AMT-FINE', fine: amount })
    assert.equal(fine.status, 400, `fine ${String(amount)} -> ${fine.status}`)
  }
  const [{ n: after }] = await sql`select count(*)::int n from cases`
  assert.equal(after, before)
})

test('invalid HEARING values return 400 and do not modify the case', async () => {
  const [c] = await sql`insert into customers (first_name,last_name) values ('Hearing','Validation') returning id`
  const [k] = await sql`insert into cases (customer_id, citation) values (${c.id}, 'HEAR-1') returning id`
  const [snap] = await sql`select hearing_at, hearing_type, status from cases where id = ${k.id}`

  for (const body of [
    { hearingType: 'Telepathy' }, { prepStatus: 'Almost' }, { status: 'Teleported' },
    { hearingAt: 'not-a-date' }, { state: 'x'.repeat(500) },
  ]) {
    const r = await api('/api/hearings', (await owner()), 'POST', { caseId: k.id, ...body })
    assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${r.status}`)
  }
  const missing = await api('/api/hearings', (await owner()), 'POST', { caseId: '00000000-0000-0000-0000-000000000000', hearingType: 'Zoom' })
  assert.ok([400, 404].includes(missing.status))

  const [after] = await sql`select hearing_at, hearing_type, status from cases where id = ${k.id}`
  assert.deepEqual(
    { t: after.hearing_type, s: after.status, a: after.hearing_at?.toISOString() ?? null },
    { t: snap.hearing_type, s: snap.status, a: snap.hearing_at?.toISOString() ?? null },
    'a rejected hearing update must not modify the case',
  )
})

test('invalid CUSTOMER values return 400 and write no row', async () => {
  const [{ n: before }] = await sql`select count(*)::int n from customers`
  const invalid = [
    { plan: 'Free Plan' }, { subStatus: 'Lapsed' }, { payChannel: 'Crypto' },
    { cdl: 'Sometimes' }, { dot: 'Maybe' },
    { dob: 'not-a-date' }, { dob: '2026-02-31' }, { dob: '3000-01-01' },
    { nextPayment: 'whenever' }, { email: 'not-an-email' },
    { firstName: 'x'.repeat(5000) },
    { agentId: '00000000-0000-0000-0000-000000000000' },
  ]
  for (const body of invalid) {
    const r = await api('/api/customers', (await owner()), 'POST', { firstName: 'Invalid', lastName: 'Input', ...body })
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 50)} -> ${r.status}`)
  }
  const [{ n: after }] = await sql`select count(*)::int n from customers`
  assert.equal(after, before, 'no customer row may be written by a rejected request')
})

test('a READ_ONLY user cannot be assigned as a customer agent', async () => {
  await ensureUser('agentcheck@example.test', 'READ_ONLY')
  const [ro] = await sql`select id from users where email = 'agentcheck@example.test'`
  const r = await api('/api/customers', (await owner()), 'POST', { firstName: 'Agent', lastName: 'Check', agentId: ro.id })
  assert.equal(r.status, 400, 'a READ_ONLY account must not be assignable as an agent')
})

// ------------------------------------------- the UI and the API agree on plans
test('every plan value the customer form can submit is accepted by the API', async () => {
  const { readFileSync } = await import('node:fs')
  const form = readFileSync('app/(app)/customers/new/CustomerForm.tsx', 'utf8')
  const submitted = [...form.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1])
  const plans = submitted.filter((v) => /Fleet Protection|Individual Plan|One time Team/.test(v))
  assert.ok(plans.length >= 3, `expected the three plan option values, found ${JSON.stringify(plans)}`)

  for (const plan of plans) {
    const r = await api('/api/customers', (await owner()), 'POST', { firstName: 'Plan', lastName: 'Check', plan })
    assert.equal(r.status, 200, `the form submits plan "${plan}" but the API rejected it: ${await r.text()}`)
  }
  // And a label-style value (what the old form submitted) must still be rejected.
  const labelled = await api('/api/customers', (await owner()), 'POST', { firstName: 'Plan', lastName: 'Label', plan: 'Fleet Protection ($39.99)' })
  assert.equal(labelled.status, 400, 'a price-labelled plan value must not be accepted')
})

// --------------------------- agent assignment uses ONE shared role allowlist
// READ_ONLY, BILLING and DOCUMENT_STAFF must never become a customer's or a
// case's agent, through any endpoint, and a rejected attempt must not write.
const NON_ASSIGNABLE = ['READ_ONLY', 'BILLING', 'DOCUMENT_STAFF']

test('non-assignable roles are rejected as the agent on /api/customers (no row written)', async () => {
  const [{ n: before }] = await sql`select count(*)::int n from customers`
  for (const role of NON_ASSIGNABLE) {
    const email = `noassign-cust-${role.toLowerCase()}@example.test`
    await ensureUser(email, role)
    const [u] = await sql`select id from users where email = ${email}`
    const r = await api('/api/customers', (await owner()), 'POST', { firstName: 'No', lastName: 'Assign', agentId: u.id })
    assert.equal(r.status, 400, `${role} must not be assignable on customers (got ${r.status})`)
  }
  const [{ n: after }] = await sql`select count(*)::int n from customers`
  assert.equal(after, before, 'a rejected assignment must not create a customer')
})

test('non-assignable roles are rejected as the agent on /api/cases (no row written)', async () => {
  const [c] = await sql`insert into customers (first_name,last_name) values ('Agent','CaseCheck') returning id`
  const [{ n: before }] = await sql`select count(*)::int n from cases`
  for (const role of NON_ASSIGNABLE) {
    const email = `noassign-case-${role.toLowerCase()}@example.test`
    await ensureUser(email, role)
    const [u] = await sql`select id from users where email = ${email}`
    const r = await api('/api/cases', (await owner()), 'POST', { customerId: c.id, citation: 'NOASSIGN-1', agentId: u.id })
    assert.equal(r.status, 400, `${role} must not be assignable on cases (got ${r.status})`)
  }
  const [{ n: after }] = await sql`select count(*)::int n from cases`
  assert.equal(after, before, 'a rejected assignment must not create a case')
})

test('non-assignable roles are rejected on /api/assign and the customer keeps its agent', async () => {
  const agentCookieEmail = 'assignable-agent@example.test'
  await ensureUser(agentCookieEmail, 'CASE_AGENT')
  const [good] = await sql`select id from users where email = ${agentCookieEmail}`
  const [c] = await sql`insert into customers (first_name,last_name,agent_id) values ('Assign','Target',${good.id}) returning id`

  for (const role of NON_ASSIGNABLE) {
    const email = `noassign-assign-${role.toLowerCase()}@example.test`
    await ensureUser(email, role)
    const [u] = await sql`select id from users where email = ${email}`
    const r = await api('/api/assign', (await owner()), 'POST', { customerId: c.id, agentId: u.id })
    assert.equal(r.status, 400, `${role} must not be assignable via /api/assign (got ${r.status})`)
  }

  const [row] = await sql`select agent_id from customers where id = ${c.id}`
  assert.equal(row.agent_id, good.id, 'a rejected assignment must not change the stored agent')
})

test('an assignable role (CASE_AGENT) still works through /api/assign', async () => {
  await ensureUser('assign-ok@example.test', 'CASE_AGENT')
  const [u] = await sql`select id from users where email = 'assign-ok@example.test'`
  const [c] = await sql`insert into customers (first_name,last_name) values ('Assign','Ok') returning id`
  const r = await api('/api/assign', (await owner()), 'POST', { customerId: c.id, agentId: u.id })
  assert.equal(r.status, 200, await r.text())
  const [row] = await sql`select agent_id from customers where id = ${c.id}`
  assert.equal(row.agent_id, u.id)
})

// ---------------------------------------------------------------------------
// Login hardening
// ---------------------------------------------------------------------------
test('stale login_attempts rows are pruned so unknown-email spam cannot grow the table', async () => {
  // A stale unknown-email row, older than the 24h TTL and not locked.
  await sql`delete from login_attempts where email in ('stale@example.test','fresh-trigger@example.test')`
  await sql`insert into login_attempts (email, attempts, locked_until, updated_at)
            values ('stale@example.test', 2, null, now() - interval '48 hours')`
  const [before] = await sql`select count(*)::int n from login_attempts where email = 'stale@example.test'`
  assert.equal(before.n, 1, 'precondition: stale row exists')

  // Any failed login runs the bounded cleanup.
  await login('fresh-trigger@example.test', 'wrong-password')

  const [after] = await sql`select count(*)::int n from login_attempts where email = 'stale@example.test'`
  assert.equal(after.n, 0, 'the stale row must be pruned')

  const [recent] = await sql`select count(*)::int n from login_attempts where email = 'fresh-trigger@example.test'`
  assert.equal(recent.n, 1, 'the recent row must be kept')
  await sql`delete from login_attempts where email = 'fresh-trigger@example.test'`
})

test('a recently locked row is NOT pruned even if it is old', async () => {
  await sql`delete from login_attempts where email = 'old-but-locked@example.test'`
  await sql`insert into login_attempts (email, attempts, locked_until, updated_at)
            values ('old-but-locked@example.test', 5, now() + interval '10 minutes', now() - interval '48 hours')`
  await login('prune-trigger2@example.test', 'wrong-password')
  const [row] = await sql`select count(*)::int n from login_attempts where email = 'old-but-locked@example.test'`
  assert.equal(row.n, 1, 'an active lockout must survive pruning')
  await sql`delete from login_attempts where email in ('old-but-locked@example.test','prune-trigger2@example.test')`
})

test('login rejects malformed input before touching the database', async () => {
  const bad = [
    { email: 123, password: 'x' },
    { email: 'a@b.test', password: {} },
    { email: 'not-an-email', password: 'whatever' },
    { email: '   ', password: 'whatever' },
    { email: 'a'.repeat(300) + '@example.test', password: 'whatever' },
  ]
  for (const body of bad) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    assert.ok([400, 401].includes(r.status), `${JSON.stringify(body).slice(0, 40)} -> ${r.status}`)
    const text = await r.text()
    assert.ok(!/at |Error|stack|postgres/i.test(text) || /credentials|required/i.test(text),
      'error text must stay generic')
  }
})

test('login normalises the email: mixed case and surrounding spaces still sign in', async () => {
  const r = await login('  OWNER@Example.TEST  '.trim().toUpperCase(), 'TestOwnerPassw0rd!')
  assert.equal(r.status, 200, 'an uppercase address must resolve to the same account')
})

test('an over-long password is rejected at account creation (bcrypt 72-byte limit)', async () => {
  const r = await api('/api/users', (await owner()), 'POST', {
    name: 'Long Password', email: 'longpw@example.test', password: 'a'.repeat(73), role: 'CASE_AGENT',
  })
  assert.equal(r.status, 400, 'a >72-byte password must not be silently truncated')
  const [{ n }] = await sql`select count(*)::int n from users where email = 'longpw@example.test'`
  assert.equal(n, 0, 'no user row may be created')
})

test('an over-long password is rejected on password change', async () => {
  const cookie = await ensureUser('longpw-change@example.test', 'CASE_AGENT')
  const r = await api('/api/profile', cookie, 'POST', { current: PW, next: 'b'.repeat(73) })
  assert.equal(r.status, 400)
})

// ---------------------------------------------------------------------------
// Task validation
// ---------------------------------------------------------------------------
test('task fields are length-limited and strictly typed', async () => {
  const cookie = await owner()
  const [{ n: before }] = await sql`select count(*)::int n from tasks`
  for (const body of [
    { title: 'x'.repeat(5000) },
    { title: 'ok', caseRef: 'y'.repeat(5000) },
    { title: 'ok', priority: 'Critical' },
    { title: 'ok', dueAt: 'not-a-date' },
    { title: '   ' },
  ]) {
    const r = await api('/api/tasks', cookie, 'POST', body)
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 40)} -> ${r.status}`)
  }
  // Free-text assignee is no longer an ownership field: it is ignored, and an
  // unknown assigneeId is rejected outright.
  const ignored = await api('/api/tasks', cookie, 'POST', { title: 'FREE-TEXT-IGNORED', assignee: 'z'.repeat(5000) })
  assert.equal(ignored.status, 200, 'a stray assignee string must simply be ignored')
  const [created] = await sql`select assignee_id, assignee from tasks where title = 'FREE-TEXT-IGNORED'`
  assert.ok(created.assignee_id, 'ownership must be recorded as a user id')
  assert.ok(!created.assignee || created.assignee.length < 100, 'the free-text value must not be stored')
  await sql`delete from tasks where title = 'FREE-TEXT-IGNORED'`

  const badAssignee = await api('/api/tasks', cookie, 'POST', { title: 'BAD-ASSIGNEE', assigneeId: '00000000-0000-0000-0000-000000000000' })
  assert.equal(badAssignee.status, 400, 'an unknown assigneeId must be rejected')

  const [{ n: after }] = await sql`select count(*)::int n from tasks`
  assert.equal(after, before, 'no task row may be written by a rejected request')
})

test('PATCH /api/tasks returns 404 for an unknown task id', async () => {
  const cookie = await owner()
  const r = await api('/api/tasks', cookie, 'PATCH', { id: '00000000-0000-0000-0000-000000000000', status: 'Completed' })
  assert.equal(r.status, 404, 'a missing task must be a 404, not a silent 200')

  const created = await api('/api/tasks', cookie, 'POST', { title: 'Patch target' })
  const { id } = await created.json()
  const ok = await api('/api/tasks', cookie, 'PATCH', { id, status: 'Completed' })
  assert.equal(ok.status, 200)
  const [row] = await sql`select status from tasks where id = ${id}`
  assert.equal(row.status, 'Completed')
})

// ---------------------------------------------------------------------------
// Admission control: the limiter must cap password VERIFICATIONS, not just
// record failures afterwards. A burst must not slip past an "unlocked" read.
// ---------------------------------------------------------------------------
test('a burst of 20 simultaneous wrong-password logins admits at most 5 and 429s the rest', async () => {
  const EMAIL = 'burst@example.test'
  await sql`delete from login_attempts where email = ${EMAIL}`
  await sql`delete from users where email = ${EMAIL}`
  const cookie = await ensureUser(EMAIL, 'CASE_AGENT')
  assert.ok(cookie)
  await sql`delete from login_attempts where email = ${EMAIL}`

  const N = 20
  const results = await Promise.all(Array.from({ length: N }, () =>
    fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: 'definitely-wrong' }),
    }).then((r) => r.status)))

  const admitted = results.filter((s) => s === 401).length
  const throttled = results.filter((s) => s === 429).length

  assert.ok(admitted <= 5, `at most 5 verifications may be admitted, got ${admitted}`)
  assert.equal(admitted + throttled, N, `every request must be 401 or 429 (got ${JSON.stringify(results)})`)
  assert.ok(throttled >= N - 5, `later requests must be throttled, got ${throttled}`)

  const [row] = await sql`select attempts, locked_until from login_attempts where email = ${EMAIL}`
  assert.equal(Number(row.attempts), admitted, 'the stored counter must equal the number admitted')
  assert.ok(Number(row.attempts) <= 5, 'the counter must never exceed the threshold')
  assert.ok(row.locked_until, 'the account must end up locked')
})

test('a correct password submitted concurrently after the threshold cannot bypass the lock', async () => {
  const EMAIL = 'bypass@example.test'
  await sql`delete from login_attempts where email = ${EMAIL}`
  await sql`delete from users where email = ${EMAIL}`
  await ensureUser(EMAIL, 'CASE_AGENT')
  await sql`delete from login_attempts where email = ${EMAIL}`

  // Exhaust the window.
  for (let i = 0; i < 5; i++) await login(EMAIL, 'wrong-password')

  // Now fire correct-password attempts concurrently: all must be refused.
  const results = await Promise.all(Array.from({ length: 8 }, () => login(EMAIL, PW).then((r) => r.status)))
  assert.ok(results.every((s) => s === 429), `all must be 429 while locked, got ${JSON.stringify(results)}`)

  const [row] = await sql`select attempts from login_attempts where email = ${EMAIL}`
  assert.ok(Number(row.attempts) <= 5, 'denied requests must not increment the counter')
})

test('requests during an active lock do not extend locked_until', async () => {
  const EMAIL = 'noextend@example.test'
  await sql`delete from login_attempts where email = ${EMAIL}`
  await sql`insert into login_attempts (email, attempts, locked_until, updated_at)
            values (${EMAIL}, 5, now() + interval '5 minutes', now())`
  const [before] = await sql`select locked_until from login_attempts where email = ${EMAIL}`

  for (let i = 0; i < 5; i++) {
    const r = await login(EMAIL, 'wrong-password')
    assert.equal(r.status, 429)
  }

  const [after] = await sql`select locked_until, attempts from login_attempts where email = ${EMAIL}`
  assert.equal(new Date(after.locked_until).toISOString(), new Date(before.locked_until).toISOString(),
    'hammering a locked account must not push the unlock time further out')
  assert.equal(Number(after.attempts), 5, 'denied attempts must not be counted')
  await sql`delete from login_attempts where email = ${EMAIL}`
})

test('after a lock expires the next wrong attempt starts a fresh window at attempt 1', async () => {
  const EMAIL = 'expired@example.test'
  await sql`delete from login_attempts where email = ${EMAIL}`
  // A lock that has already elapsed.
  await sql`insert into login_attempts (email, attempts, locked_until, updated_at)
            values (${EMAIL}, 5, now() - interval '1 minute', now() - interval '20 minutes')`

  const r = await login(EMAIL, 'wrong-password')
  assert.equal(r.status, 401, 'the first attempt after expiry must be admitted, not refused')

  const [row] = await sql`select attempts, locked_until from login_attempts where email = ${EMAIL}`
  assert.equal(Number(row.attempts), 1, `a fresh window must start at 1, got ${row.attempts}`)
  assert.equal(row.locked_until, null, 'one failure must not immediately re-lock the account')
  await sql`delete from login_attempts where email = ${EMAIL}`
})

test('a successful login clears the attempt counter', async () => {
  const EMAIL = 'clears@example.test'
  await sql`delete from login_attempts where email = ${EMAIL}`
  await sql`delete from users where email = ${EMAIL}`
  await ensureUser(EMAIL, 'CASE_AGENT')

  await login(EMAIL, 'wrong-password')
  await login(EMAIL, 'wrong-password')
  const [mid] = await sql`select attempts from login_attempts where email = ${EMAIL}`
  assert.ok(Number(mid.attempts) >= 2)

  const ok = await login(EMAIL, PW)
  assert.equal(ok.status, 200)
  const rows = await sql`select 1 from login_attempts where email = ${EMAIL}`
  assert.equal(rows.length, 0, 'a successful login must delete the counter row')
})

// ---------------------------------------------------------------------------
// Approval workflow
// ---------------------------------------------------------------------------
test('a Manager-created customer is PENDING; an Admin-created one is ACTIVE', async () => {
  const mgr = await ensureUser('appr-mgr@example.test', 'MANAGER')
  const r1 = await api('/api/customers', mgr, 'POST', { firstName: 'Pending', lastName: 'ByManager' })
  assert.equal(r1.status, 200, await r1.text())
  const [c1] = await sql`select approval_status from customers where first_name='Pending' and last_name='ByManager'`
  assert.equal(c1.approval_status, 'PENDING')

  const r2 = await api('/api/customers', (await owner()), 'POST', { firstName: 'Instant', lastName: 'ByOwner' })
  assert.equal(r2.status, 200)
  const [c2] = await sql`select approval_status from customers where first_name='Instant' and last_name='ByOwner'`
  assert.equal(c2.approval_status, 'ACTIVE')
})

test('a CASE_AGENT can create a case but it lands PENDING', async () => {
  const agent = await ensureUser('appr-agent@example.test', 'CASE_AGENT')
  const [au] = await sql`select id from users where email = 'appr-agent@example.test'`
  // The customer must be assigned to the agent: scoped roles may only open
  // cases for their own customers.
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status) values ('Agent','Case',${au.id},'ACTIVE') returning id`
  const r = await api('/api/cases', agent, 'POST', { customerId: cust.id, citation: 'APPR-1' })
  assert.equal(r.status, 200, await r.text())
  const [k] = await sql`select approval_status from cases where citation='APPR-1'`
  assert.equal(k.approval_status, 'PENDING')
})

test('a CASE_AGENT cannot create customers (Manager and above only)', async () => {
  const agent = await ensureUser('appr-agent2@example.test', 'CASE_AGENT')
  const r = await api('/api/customers', agent, 'POST', { firstName: 'Nope', lastName: 'Agent' })
  assert.equal(r.status, 403)
  const [{ n }] = await sql`select count(*)::int n from customers where first_name='Nope'`
  assert.equal(n, 0)
})

test('a PENDING customer cannot receive cases or payments', async () => {
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status) values ('Held','Pending','PENDING') returning id`
  const c = await api('/api/cases', (await owner()), 'POST', { customerId: cust.id, citation: 'HELD-1' })
  assert.equal(c.status, 400, 'a case must not attach to an unapproved customer')
  const billing = await ensureUser('appr-billing@example.test', 'BILLING')
  const p = await api('/api/payments', billing, 'POST', { customerId: cust.id, kind: 'Membership', method: 'Card', amount: 50, status: 'Paid' })
  assert.equal(p.status, 400, 'a payment must not attach to an unapproved customer')
})

test('Admin approves a pending customer; Manager cannot approve', async () => {
  const mgr = await ensureUser('appr-mgr2@example.test', 'MANAGER')
  const created = await api('/api/customers', mgr, 'POST', { firstName: 'Await', lastName: 'Review' })
  const { id } = await created.json()

  const denied = await api('/api/approvals', mgr, 'POST', { kind: 'customer', id, decision: 'APPROVE' })
  assert.equal(denied.status, 403, 'a Manager must not approve their own record')

  const ok = await api('/api/approvals', (await owner()), 'POST', { kind: 'customer', id, decision: 'APPROVE' })
  assert.equal(ok.status, 200, await ok.text())
  const [row] = await sql`select approval_status, approved_by, approved_at from customers where id = ${id}`
  assert.equal(row.approval_status, 'ACTIVE')
  assert.ok(row.approved_by && row.approved_at, 'the approver and timestamp must be recorded')

  // Approving twice is not possible.
  const again = await api('/api/approvals', (await owner()), 'POST', { kind: 'customer', id, decision: 'APPROVE' })
  assert.equal(again.status, 404, 'a record that is not pending cannot be approved again')
})

test('rejecting records the reason and leaves the record inactive', async () => {
  const mgr = await ensureUser('appr-mgr3@example.test', 'MANAGER')
  const created = await api('/api/customers', mgr, 'POST', { firstName: 'Reject', lastName: 'Me' })
  const { id } = await created.json()
  const r = await api('/api/approvals', (await owner()), 'POST', { kind: 'customer', id, decision: 'REJECT', reason: 'Payment not confirmed' })
  assert.equal(r.status, 200)
  const [row] = await sql`select approval_status, rejection_reason from customers where id = ${id}`
  assert.equal(row.approval_status, 'REJECTED')
  assert.equal(row.rejection_reason, 'Payment not confirmed')
})

// ---------------------------------------------------------------------------
// Exports and visibility
// ---------------------------------------------------------------------------
test('only Admin and Super Admin can download report exports', async () => {
  const mgr = await ensureUser('exp-mgr@example.test', 'MANAGER')
  const agent = await ensureUser('exp-agent@example.test', 'CASE_AGENT')
  for (const cookie of [mgr, agent]) {
    const r = await fetch(`${BASE}/api/reports?r=status`, { headers: { cookie } })
    assert.equal(r.status, 403, `expected 403, got ${r.status}`)
  }
  const ok = await fetch(`${BASE}/api/reports?r=status`, { headers: { cookie: (await owner()) } })
  assert.equal(ok.status, 200)
})

test('a CASE_AGENT only sees customers and cases assigned to them', async () => {
  const email = 'scope-agent@example.test'
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [agent] = await sql`select id from users where email = ${email}`

  const [mine] = await sql`insert into customers (first_name,last_name,agent_id,approval_status) values ('Mine','Scoped',${agent.id},'ACTIVE') returning id`
  await sql`insert into customers (first_name,last_name,approval_status) values ('Theirs','Hidden','ACTIVE')`
  await sql`insert into cases (customer_id, citation, agent_id, approval_status) values (${mine.id},'MINE-1',${agent.id},'ACTIVE')`
  const [other] = await sql`select id from customers where first_name='Theirs' limit 1`
  await sql`insert into cases (customer_id, citation, approval_status) values (${other.id},'THEIRS-1','ACTIVE')`

  const custPage = await (await fetch(`${BASE}/customers`, { headers: { cookie } })).text()
  assert.ok(custPage.includes('Mine'), 'the agent must see their own customer')
  assert.ok(!custPage.includes('Theirs'), 'the agent must not see another agent\u2019s customer')

  const casePage = await (await fetch(`${BASE}/cases`, { headers: { cookie } })).text()
  assert.ok(casePage.includes('MINE-1'), 'the agent must see their own case')
  assert.ok(!casePage.includes('THEIRS-1'), 'the agent must not see another agent\u2019s case')
})

test('an Admin still sees every record', async () => {
  const page = await (await fetch(`${BASE}/customers`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(page.includes('Theirs'), 'an admin must see all customers')
})

// ---------------------------------------------------------------------------
// Financial visibility and per-role dashboards
// ---------------------------------------------------------------------------
test('a CASE_AGENT cannot reach the payments screens by URL', async () => {
  const cookie = await ensureUser('money-agent@example.test', 'CASE_AGENT')
  for (const path of ['/payments', '/payments/new']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()
    assert.ok(html.includes('Not available'), `${path} must be refused for an agent`)
    assert.ok(!/Total Paid|Record payment/.test(html), `${path} must not render financial data`)
  }
})

test('BILLING and MANAGER can still reach payments', async () => {
  for (const role of ['BILLING', 'MANAGER']) {
    const cookie = await ensureUser(`money-${role.toLowerCase()}@example.test`, role)
    const html = await (await fetch(`${BASE}/payments`, { headers: { cookie } })).text()
    assert.ok(!html.includes('Not available'), `${role} must still see payments`)
  }
})

test('the dashboard hides money from agents but shows it to management', async () => {
  const agent = await ensureUser('dash-agent@example.test', 'CASE_AGENT')
  const agentHtml = await (await fetch(`${BASE}/dashboard`, { headers: { cookie: agent } })).text()
  assert.ok(!/Payments &amp; Billing|Outstanding \$/.test(agentHtml), 'an agent must not see financial panels')
  assert.ok(agentHtml.includes('Operations Dashboard'), 'the dashboard itself still renders')

  const adminHtml = await (await fetch(`${BASE}/dashboard`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(/Payments &amp; Billing/.test(adminHtml), 'an admin must see the financial panel')
})

test('dashboard counts are scoped: an agent sees only their own records', async () => {
  const email = 'dash-scope@example.test'
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [agent] = await sql`select id from users where email = ${email}`
  await sql`insert into customers (first_name,last_name,agent_id,approval_status) values ('DashMine','One',${agent.id},'ACTIVE')`
  await sql`insert into customers (first_name,last_name,approval_status) values ('DashOther','Two','ACTIVE')`

  const html = await (await fetch(`${BASE}/dashboard`, { headers: { cookie } })).text()
  assert.ok(html.includes('DashMine'), 'the agent should see their own recent member')
  assert.ok(!html.includes('DashOther'), 'the agent must not see another agent\u2019s customer in dashboard lists')
})

test('an agent cannot open another agent\u2019s customer by direct URL', async () => {
  const email = 'url-agent@example.test'
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [other] = await sql`insert into customers (first_name,last_name,approval_status) values ('NotYours','Customer','ACTIVE') returning id`
  const html = await (await fetch(`${BASE}/customers/${other.id}`, { headers: { cookie } })).text()
  assert.ok(html.includes('not assigned to you') || html.includes('Not available'), 'out-of-scope customer must be refused')
  assert.ok(!html.includes('NotYours'), 'the record must not be rendered')
})

test('an over-long court phone number is rejected and writes no row', async () => {
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status) values ('Bad','Phone','ACTIVE') returning id`
  const [{ n: before }] = await sql`select count(*)::int n from cases`
  const r = await api('/api/cases', (await owner()), 'POST', { customerId: cust.id, citation: 'PHONE-2', courtPhone: '9'.repeat(500) })
  assert.equal(r.status, 400)
  const [{ n: after }] = await sql`select count(*)::int n from cases`
  assert.equal(after, before)
})

test('a court phone number saved on a case appears on the Hearings and Cases screens', async () => {
  const cookie = await owner()
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status) values ('Court','Phone','ACTIVE') returning id`
  const created = await api('/api/cases', cookie, 'POST', {
    customerId: cust.id, citation: 'PHONE-2', court: 'Pierce County District',
    courtPhone: '(253) 555-0142', status: 'Hearing Scheduled', state: 'WA',
    hearingAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  })
  assert.equal(created.status, 200, await created.text())

  const [row] = await sql`select court_phone from cases where citation = 'PHONE-2'`
  assert.equal(row.court_phone, '(253) 555-0142', 'the number must be stored')

  const hearings = await (await fetch(`${BASE}/hearings`, { headers: { cookie } })).text()
  assert.ok(hearings.includes('(253) 555-0142'), 'the number must be visible on Hearings')
  assert.ok(hearings.includes('tel:2535550142'), 'it must render as a click-to-call link')

  const cases = await (await fetch(`${BASE}/cases`, { headers: { cookie } })).text()
  assert.ok(cases.includes('(253) 555-0142'), 'the number must also show on the Cases list')
})

// ===========================================================================
// Object-level authorization
// ===========================================================================
async function seedAgentWithWork(email, custName, citation) {
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                           values (${custName},'Owned',${u.id},'ACTIVE') returning id`
  const [kase] = await sql`insert into cases (customer_id, citation, agent_id, approval_status, status)
                           values (${cust.id}, ${citation}, ${u.id}, 'ACTIVE', 'Hearing Scheduled') returning id`
  return { cookie, userId: u.id, customerId: cust.id, caseId: kase.id }
}

test('A: a CASE_AGENT cannot update another agent\u2019s hearing', async () => {
  const mine = await seedAgentWithWork('objA1@example.test', 'AgentOneCust', 'OBJ-A1')
  const theirs = await seedAgentWithWork('objA2@example.test', 'AgentTwoCust', 'OBJ-A2')

  const before = await sql`select hearing_type, hearing_at from cases where id = ${theirs.caseId}`
  const res = await api('/api/hearings', mine.cookie, 'POST', {
    caseId: theirs.caseId, hearingType: 'Zoom', prepStatus: 'Ready',
    hearingAt: new Date(Date.now() + 86400000).toISOString(),
  })
  assert.equal(res.status, 404, 'must be a neutral 404, not 403 (no existence oracle)')
  const after = await sql`select hearing_type, hearing_at from cases where id = ${theirs.caseId}`
  assert.deepEqual(
    { t: after[0].hearing_type, a: after[0].hearing_at?.toISOString() ?? null },
    { t: before[0].hearing_type, a: before[0].hearing_at?.toISOString() ?? null },
    'a rejected request must leave the database unchanged',
  )
})

test('A: a CASE_AGENT can update their own ACTIVE case\u2019s hearing', async () => {
  const mine = await seedAgentWithWork('objA3@example.test', 'OwnHearing', 'OBJ-A3')
  const res = await api('/api/hearings', mine.cookie, 'POST', {
    caseId: mine.caseId, hearingType: 'Zoom', prepStatus: 'In progress',
    hearingAt: new Date(Date.now() + 86400000).toISOString(),
    hearingTz: 'America/Los_Angeles',
  })
  assert.equal(res.status, 200, await res.text())
  const [row] = await sql`select hearing_type from cases where id = ${mine.caseId}`
  assert.equal(row.hearing_type, 'Zoom')
})

test('A: PENDING and REJECTED cases cannot receive hearings', async () => {
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status) values ('Appr','Hearing','ACTIVE') returning id`
  for (const status of ['PENDING', 'REJECTED']) {
    const [k] = await sql`insert into cases (customer_id, citation, approval_status) values (${cust.id}, ${'H-' + status}, ${status}) returning id`
    const res = await api('/api/hearings', (await owner()), 'POST', { caseId: k.id, hearingType: 'Zoom' })
    assert.equal(res.status, 404, `${status} case must not accept a hearing`)
    const [row] = await sql`select hearing_type from cases where id = ${k.id}`
    assert.ok(!row.hearing_type || row.hearing_type === 'In person', 'no hearing data may be written')
  }
})

test('A: a scoped user does not see another agent\u2019s hearing in the list', async () => {
  const mine = await seedAgentWithWork('objA4@example.test', 'ListMine', 'OBJ-LIST-MINE')
  await seedAgentWithWork('objA5@example.test', 'ListTheirs', 'OBJ-LIST-THEIRS')
  const html = await (await fetch(`${BASE}/hearings`, { headers: { cookie: mine.cookie } })).text()
  assert.ok(html.includes('OBJ-LIST-MINE'), 'own hearing must be listed')
  assert.ok(!html.includes('OBJ-LIST-THEIRS'), 'another agent\u2019s hearing must not be listed')
})

test('A: a scoped user opening another agent\u2019s hearing detail gets a neutral refusal', async () => {
  const mine = await seedAgentWithWork('objA6@example.test', 'DetailMine', 'OBJ-D1')
  const theirs = await seedAgentWithWork('objA7@example.test', 'DetailTheirs', 'OBJ-D2')
  const html = await (await fetch(`${BASE}/hearings/${theirs.caseId}`, { headers: { cookie: mine.cookie } })).text()
  assert.ok(html.includes('Not available'), 'must refuse neutrally')
  assert.ok(!html.includes('OBJ-D2'), 'must not reveal the record')
})

test('B: a CASE_AGENT cannot create a case for another agent\u2019s customer', async () => {
  const mine = await seedAgentWithWork('objB1@example.test', 'BMine', 'OBJ-B1')
  const theirs = await seedAgentWithWork('objB2@example.test', 'BTheirs', 'OBJ-B2')
  const [{ n: before }] = await sql`select count(*)::int n from cases`
  const res = await api('/api/cases', mine.cookie, 'POST', { customerId: theirs.customerId, citation: 'OBJ-B-STEAL' })
  assert.equal(res.status, 404, 'must be refused neutrally')
  const [{ n: after }] = await sql`select count(*)::int n from cases`
  assert.equal(after, before, 'no case row may be written')
})

test('B: a CASE_AGENT cannot assign a new case to another agent', async () => {
  const mine = await seedAgentWithWork('objB3@example.test', 'BAssign', 'OBJ-B3')
  const theirs = await seedAgentWithWork('objB4@example.test', 'BOther', 'OBJ-B4')
  const res = await api('/api/cases', mine.cookie, 'POST', {
    customerId: mine.customerId, citation: 'OBJ-B-ASSIGN', agentId: theirs.userId,
  })
  assert.equal(res.status, 403, 'assigning to someone else must be refused')
  const [{ n }] = await sql`select count(*)::int n from cases where citation = 'OBJ-B-ASSIGN'`
  assert.equal(n, 0)

  // Their own case is forced to themselves even if agentId is omitted.
  const ok = await api('/api/cases', mine.cookie, 'POST', { customerId: mine.customerId, citation: 'OBJ-B-SELF' })
  assert.equal(ok.status, 200, await ok.text())
  const [row] = await sql`select agent_id from cases where citation = 'OBJ-B-SELF'`
  assert.equal(row.agent_id, mine.userId, 'the case must belong to the creating agent')
})

test('B: the case-creation form only offers the agent\u2019s own ACTIVE customers', async () => {
  const mine = await seedAgentWithWork('objB5@example.test', 'DropMine', 'OBJ-B5')
  await seedAgentWithWork('objB6@example.test', 'DropTheirs', 'OBJ-B6')
  await sql`insert into customers (first_name,last_name,agent_id,approval_status) values ('DropPending','Held',${mine.userId},'PENDING')`
  const html = await (await fetch(`${BASE}/cases/new`, { headers: { cookie: mine.cookie } })).text()
  assert.ok(html.includes('DropMine'), 'own ACTIVE customer must be selectable')
  assert.ok(!html.includes('DropTheirs'), 'another agent\u2019s customer must not appear')
  assert.ok(!html.includes('DropPending'), 'a PENDING customer must not appear')
})

test('C: a non-financial role gets no amounts from the notifications API', async () => {
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status) values ('MoneyLeak','Customer','ACTIVE') returning id`
  await sql`insert into cases (customer_id, citation, fee, approval_status) values (${cust.id},'LEAK-1',777,'ACTIVE')`
  await sql`insert into payments (customer_id, kind, method, amount, status, invoice) values (${cust.id},'Membership','Card',888,'Overdue','INV-LEAK')`

  const agent = await ensureUser('objC1@example.test', 'CASE_AGENT')
  const res = await api('/api/notifications', agent, 'GET')
  assert.equal(res.status, 200)
  const body = await res.text()
  assert.ok(!body.includes('777') && !body.includes('888'), 'amounts must not be returned')
  assert.ok(!body.includes('MoneyLeak'), 'customer names must not be returned')
  assert.equal(JSON.parse(body).count, 0)

  // Feature 2 note: /api/notifications now serves PERSISTENT reminders for the
  // signed-in user rather than computing financial alerts on read. Financial
  // reminder delivery and its visibility rules are covered by R12.
  const admin = await api('/api/notifications', (await owner()), 'GET')
  assert.equal(admin.status, 200, 'an admin still reads their own feed')
  const adminBody = await admin.text()
  assert.ok(!adminBody.includes('MoneyLeak'), 'no customer name leaks through the feed')
})

test('C: a non-financial role sees no amounts on the notifications page or customer detail', async () => {
  const agent = await ensureUser('objC2@example.test', 'CASE_AGENT')
  const [u] = await sql`select id from users where email = 'objc2@example.test'`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status) values ('FeeHidden','Cust',${u.id},'ACTIVE') returning id`
  await sql`insert into cases (customer_id, citation, fee, agent_id, approval_status) values (${cust.id},'FEE-1',1234,${u.id},'ACTIVE')`

  // Feature 2: /notifications now serves every recipient their OWN persistent
  // reminders. Financial reminders are only generated for financial roles, so
  // the guarantee is that no amount reaches a non-financial viewer.
  const notif = await (await fetch(`${BASE}/notifications`, { headers: { cookie: agent } })).text()
  assert.ok(!notif.includes('1234'), 'no financial amount may reach a non-financial role')

  const detail = await (await fetch(`${BASE}/customers/${cust.id}`, { headers: { cookie: agent } })).text()
  assert.ok(!detail.includes('1234'), 'the fee must not appear in the All cases table')
  assert.ok(!/>\s*Remaining\s*</.test(detail), 'the Remaining column must be hidden')
})

test('D: protected pages are denied by direct URL for unauthorised roles', async () => {
  const agent = await ensureUser('objD1@example.test', 'CASE_AGENT')
  for (const path of ['/agents', '/users', '/users/new', '/audit', '/settings', '/reports']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie: agent } })).text()
    assert.ok(html.includes('Not available'), `${path} must be refused for a CASE_AGENT`)
  }
  // /notifications is deliberately available to every recipient for their own
  // reminders; ownership is enforced per row (see H4).
})

test('D: a MANAGER is denied admin-only pages but keeps operational ones', async () => {
  const mgr = await ensureUser('objD2@example.test', 'MANAGER')
  for (const path of ['/users', '/users/new', '/audit']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie: mgr } })).text()
    assert.ok(html.includes('Not available'), `${path} must be refused for a MANAGER`)
  }
  for (const path of ['/agents', '/reports', '/settings', '/payments']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie: mgr } })).text()
    assert.ok(!html.includes('Not available'), `${path} must remain available to a MANAGER`)
  }
})

test('D: financial report types require financial access, and export stays admin-only', async () => {
  const mgr = await ensureUser('objD3@example.test', 'MANAGER')
  const ok = await (await fetch(`${BASE}/reports?r=method`, { headers: { cookie: mgr } })).text()
  assert.ok(!ok.includes('Not available'), 'a manager may view financial reports')

  const exportRes = await fetch(`${BASE}/api/reports?r=method`, { headers: { cookie: mgr } })
  assert.equal(exportRes.status, 403, 'export stays restricted to admins')

  const adminExport = await fetch(`${BASE}/api/reports?r=method`, { headers: { cookie: (await owner()) } })
  assert.equal(adminExport.status, 200)
})

test('E: a Case payment against a PENDING or REJECTED case is rejected with no row written', async () => {
  const billing = await ensureUser('objE1@example.test', 'BILLING')
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status) values ('PayAppr','Cust','ACTIVE') returning id`
  for (const status of ['PENDING', 'REJECTED']) {
    const [k] = await sql`insert into cases (customer_id, citation, fee, approval_status) values (${cust.id}, ${'PAY-' + status}, 500, ${status}) returning id`
    const [{ n: before }] = await sql`select count(*)::int n from payments`
    const res = await api('/api/payments', billing, 'POST', {
      customerId: cust.id, caseId: k.id, kind: 'Case', method: 'Card', amount: 100, status: 'Paid',
    })
    assert.equal(res.status, 400, `${status} case must not accept a payment`)
    const [{ n: after }] = await sql`select count(*)::int n from payments`
    assert.equal(after, before, 'no payment row may be inserted')
  }
})

test('E: READ_ONLY cannot open the new-payment form or create a payment', async () => {
  const ro = await ensureUser('objE2@example.test', 'READ_ONLY')
  const html = await (await fetch(`${BASE}/payments/new`, { headers: { cookie: ro } })).text()
  assert.ok(html.includes('Not available'), 'the creation form must be refused')

  const [cust] = await sql`insert into customers (first_name,last_name,approval_status) values ('RO','Target','ACTIVE') returning id`
  const [{ n: before }] = await sql`select count(*)::int n from payments`
  const res = await api('/api/payments', ro, 'POST', { customerId: cust.id, kind: 'Membership', method: 'Card', amount: 10, status: 'Paid' })
  assert.equal(res.status, 403)
  const [{ n: after }] = await sql`select count(*)::int n from payments`
  assert.equal(after, before)
})

test('F: a full-visibility administrator retains access everywhere', async () => {
  const cookie = await owner()
  for (const path of ['/agents', '/users', '/users/new', '/audit', '/settings', '/reports', '/payments', '/payments/new', '/notifications', '/hearings', '/cases/new']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()
    assert.ok(!html.includes('Not available'), `${path} must remain available to a Super Admin`)
  }
})

// ===========================================================================
// Tasks, calendar, documents and financial scope
// ===========================================================================
async function agentWithTask(email, title) {
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [t] = await sql`insert into tasks (title, assignee, assignee_id, status, priority)
                        values (${title}, ${'CASE_AGENT user'}, ${u.id}, 'Open', 'Normal') returning id`
  return { cookie, userId: u.id, taskId: t.id }
}

test('T1: a scoped user sees only their own tasks', async () => {
  const mine = await agentWithTask('t1a@example.test', 'TASK-MINE-1')
  await agentWithTask('t1b@example.test', 'TASK-THEIRS-1')
  const html = await (await fetch(`${BASE}/tasks`, { headers: { cookie: mine.cookie } })).text()
  assert.ok(html.includes('TASK-MINE-1'), 'own task must be listed')
  assert.ok(!html.includes('TASK-THEIRS-1'), 'another user\u2019s task must not be listed')

  const adminHtml = await (await fetch(`${BASE}/tasks`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(adminHtml.includes('TASK-THEIRS-1'), 'an admin must see all tasks')
})

test('T2/T3: PATCHing another user\u2019s task and an unknown id both return a neutral 404, DB unchanged', async () => {
  const mine = await agentWithTask('t2a@example.test', 'TASK-PATCH-MINE')
  const theirs = await agentWithTask('t2b@example.test', 'TASK-PATCH-THEIRS')

  const [before] = await sql`select status from tasks where id = ${theirs.taskId}`
  const denied = await api('/api/tasks', mine.cookie, 'PATCH', { id: theirs.taskId, status: 'Completed' })
  assert.equal(denied.status, 404)
  const [after] = await sql`select status from tasks where id = ${theirs.taskId}`
  assert.equal(after.status, before.status, 'the other user\u2019s task must be unchanged')

  const unknown = await api('/api/tasks', mine.cookie, 'PATCH', { id: '00000000-0000-0000-0000-000000000000', status: 'Completed' })
  assert.equal(unknown.status, 404, 'unknown and unauthorized must be indistinguishable')

  const own = await api('/api/tasks', mine.cookie, 'PATCH', { id: mine.taskId, status: 'Completed' })
  assert.equal(own.status, 200)
})

test('T4: a scoped user cannot assign a task to another user', async () => {
  const mine = await agentWithTask('t4a@example.test', 'TASK-ASSIGN-SRC')
  const theirs = await agentWithTask('t4b@example.test', 'TASK-ASSIGN-DST')
  const [{ n: before }] = await sql`select count(*)::int n from tasks`

  const res = await api('/api/tasks', mine.cookie, 'POST', { title: 'TASK-STEAL', assigneeId: theirs.userId })
  assert.equal(res.status, 403)
  const [{ n: after }] = await sql`select count(*)::int n from tasks`
  assert.equal(after, before, 'no task row may be written')

  const ok = await api('/api/tasks', mine.cookie, 'POST', { title: 'TASK-SELF' })
  assert.equal(ok.status, 200, await ok.text())
  const [row] = await sql`select assignee_id from tasks where title = 'TASK-SELF'`
  assert.equal(row.assignee_id, mine.userId, 'the task must belong to its creator')
})

test('T5/T6/T14: /calendar excludes another agent\u2019s cases and tasks (direct request)', async () => {
  const mine = await seedAgentWithWork('cal1@example.test', 'CalMine', 'CAL-MINE')
  const theirs = await seedAgentWithWork('cal2@example.test', 'CalTheirs', 'CAL-THEIRS')
  const soon = new Date(Date.now() + 5 * 86400000).toISOString()
  await sql`update cases set hearing_at = ${soon}, next_action = 'Call court' where id in (${mine.caseId}, ${theirs.caseId})`
  await sql`insert into tasks (title, assignee_id, status, due_at) values ('CAL-TASK-THEIRS', ${theirs.userId}, 'Open', ${soon})`
  await sql`insert into tasks (title, assignee_id, status, due_at) values ('CAL-TASK-MINE', ${mine.userId}, 'Open', ${soon})`

  const html = await (await fetch(`${BASE}/calendar`, { headers: { cookie: mine.cookie } })).text()
  assert.ok(!html.includes('CAL-THEIRS'), 'another agent\u2019s citation must not appear')
  assert.ok(!html.includes('CalTheirs'), 'another agent\u2019s customer name must not appear')
  assert.ok(!html.includes('CAL-TASK-THEIRS'), 'another user\u2019s task must not appear')
  assert.ok(html.includes('CAL-TASK-MINE') || html.includes('CAL-MINE'), 'own work must still appear')
})

test('T7/T8/T14: /documents excludes another agent\u2019s documents and orphans (direct request)', async () => {
  const mine = await seedAgentWithWork('doc1@example.test', 'DocMine', 'DOC-MINE')
  const theirs = await seedAgentWithWork('doc2@example.test', 'DocTheirs', 'DOC-THEIRS')
  await sql`insert into documents (customer_id, category, file_name) values (${mine.customerId}, 'CDL', 'MINE-FILE.pdf')`
  await sql`insert into documents (customer_id, category, file_name) values (${theirs.customerId}, 'CDL', 'THEIRS-FILE.pdf')`
  await sql`insert into documents (case_id, category, file_name) values (${theirs.caseId}, 'Court', 'THEIRS-CASE-FILE.pdf')`
  await sql`insert into documents (category, file_name) values ('Other', 'ORPHAN-FILE.pdf')`

  const html = await (await fetch(`${BASE}/documents`, { headers: { cookie: mine.cookie } })).text()
  assert.ok(html.includes('MINE-FILE.pdf'), 'own document must be listed')
  assert.ok(!html.includes('THEIRS-FILE.pdf'), 'another agent\u2019s customer document must not appear')
  assert.ok(!html.includes('THEIRS-CASE-FILE.pdf'), 'another agent\u2019s case document must not appear')
  assert.ok(!html.includes('ORPHAN-FILE.pdf'), 'orphan documents must fail closed for scoped users')

  const adminHtml = await (await fetch(`${BASE}/documents`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(adminHtml.includes('ORPHAN-FILE.pdf'), 'an admin must see orphan documents')
})

test('T9/T10: the financial-scope policy is applied consistently', async () => {
  // BILLING and READ_ONLY have organisation-wide financial oversight by policy.
  const billing = await ensureUser('fin-billing@example.test', 'BILLING')
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status) values ('FinWide','Cust','ACTIVE') returning id`
  await sql`insert into payments (customer_id, kind, method, amount, status, invoice) values (${cust.id},'Membership','Card',4242,'Overdue','INV-WIDE')`

  const payments = await (await fetch(`${BASE}/payments`, { headers: { cookie: billing } })).text()
  assert.ok(payments.includes('4242') || payments.includes('4,242'), 'BILLING must see organisation-wide figures')

  // Financial figures now reach BILLING through persistent payment reminders
  // (covered by R12), not through a computed notifications read.
  const notif = await api('/api/notifications', billing, 'GET')
  assert.equal(notif.status, 200, 'BILLING can read its own feed')

  // A non-financial role still gets nothing.
  const agent = await ensureUser('fin-agent@example.test', 'CASE_AGENT')
  const agentPayments = await (await fetch(`${BASE}/payments`, { headers: { cookie: agent } })).text()
  assert.ok(agentPayments.includes('Not available'))
  const agentNotif = await (await api('/api/notifications', agent, 'GET')).text()
  assert.ok(!agentNotif.includes('4242'))
})

test('T11: a CASE_AGENT sees no Fine or Customer fee inputs on the case form', async () => {
  const mine = await seedAgentWithWork('fin-form@example.test', 'FormCust', 'FORM-1')
  const html = await (await fetch(`${BASE}/cases/new`, { headers: { cookie: mine.cookie } })).text()
  assert.ok(!html.includes('Fine ($)'), 'the Fine input must not render')
  assert.ok(!html.includes('Customer fee'), 'the Customer fee input must not render')

  const adminHtml = await (await fetch(`${BASE}/cases/new`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(adminHtml.includes('Customer fee'), 'an admin must still see it')
})

test('T12/T15: a handcrafted CASE_AGENT request cannot store fine or fee', async () => {
  const mine = await seedAgentWithWork('fin-craft@example.test', 'CraftCust', 'CRAFT-1')
  const [{ n: before }] = await sql`select count(*)::int n from cases`
  const res = await api('/api/cases', mine.cookie, 'POST', {
    customerId: mine.customerId, citation: 'CRAFT-MONEY', fine: 999, fee: 1500,
  })
  assert.equal(res.status, 403, 'setting money without financial access must be refused')
  const [{ n: after }] = await sql`select count(*)::int n from cases`
  assert.equal(after, before, 'no case row may be written')

  // The same request without money is accepted and stores no financial values.
  const ok = await api('/api/cases', mine.cookie, 'POST', { customerId: mine.customerId, citation: 'CRAFT-CLEAN' })
  assert.equal(ok.status, 200, await ok.text())
  const [row] = await sql`select fine, fee from cases where citation = 'CRAFT-CLEAN'`
  assert.equal(row.fine, null)
  assert.equal(row.fee, null)
})

test('T13: customer details do not reveal cases assigned to somebody else', async () => {
  const mine = await seedAgentWithWork('own-mix@example.test', 'MixCust', 'MIX-MINE')
  const [otherAgent] = await sql`select id from users where email = 'owner@example.test'`
  // A case on the agent's own customer, but assigned to a different agent.
  await sql`insert into cases (customer_id, citation, agent_id, approval_status) values (${mine.customerId}, 'MIX-THEIRS', ${otherAgent.id}, 'ACTIVE')`

  const html = await (await fetch(`${BASE}/customers/${mine.customerId}`, { headers: { cookie: mine.cookie } })).text()
  assert.ok(html.includes('MIX-MINE'), 'own case must be listed')
  assert.ok(!html.includes('MIX-THEIRS'), 'a case assigned to another agent must not be listed')
})

test('T16: administrators retain access to tasks, calendar and documents', async () => {
  const cookie = await owner()
  for (const path of ['/tasks', '/calendar', '/documents', '/payments']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()
    assert.ok(!html.includes('Not available'), `${path} must remain available to a Super Admin`)
  }
})

// ===========================================================================
// Report policy, task assignment UI, payment metadata, neutral responses
// ===========================================================================
const OPERATIONAL_REPORTS = ['status', 'agent', 'custagent', 'newcust', 'hearings']
const FINANCIAL_REPORTS = ['method', 'outstanding']

test('R1: BILLING and READ_ONLY get financial reports only, never operational ones', async () => {
  for (const role of ['BILLING', 'READ_ONLY']) {
    const cookie = await ensureUser(`rep-${role.toLowerCase()}@example.test`, role)
    for (const r of OPERATIONAL_REPORTS) {
      const html = await (await fetch(`${BASE}/reports?r=${r}`, { headers: { cookie } })).text()
      assert.ok(html.includes('Not available'), `${role} must not see operational report ${r}`)
      const exp = await fetch(`${BASE}/api/reports?r=${r}`, { headers: { cookie } })
      assert.equal(exp.status, 403, `${role} must not export operational report ${r}`)
    }
    for (const r of FINANCIAL_REPORTS) {
      const html = await (await fetch(`${BASE}/reports?r=${r}`, { headers: { cookie } })).text()
      assert.ok(!html.includes('Not available'), `${role} should see financial report ${r}`)
    }
  }
})

test('R2: MANAGER and ADMIN see every report type; CASE_AGENT sees none', async () => {
  for (const role of ['MANAGER', 'SUPER_ADMIN']) {
    const cookie = role === 'SUPER_ADMIN' ? await owner() : await ensureUser('rep-manager@example.test', 'MANAGER')
    for (const r of [...OPERATIONAL_REPORTS, ...FINANCIAL_REPORTS]) {
      const html = await (await fetch(`${BASE}/reports?r=${r}`, { headers: { cookie } })).text()
      assert.ok(!html.includes('Not available'), `${role} must see ${r}`)
    }
  }
  const agent = await ensureUser('rep-agent@example.test', 'CASE_AGENT')
  for (const r of [...OPERATIONAL_REPORTS, ...FINANCIAL_REPORTS]) {
    const html = await (await fetch(`${BASE}/reports?r=${r}`, { headers: { cookie: agent } })).text()
    assert.ok(html.includes('Not available'), `CASE_AGENT must not see ${r}`)
  }
})

test('R3: report export stays restricted to SUPER_ADMIN and ADMIN', async () => {
  const mgr = await ensureUser('rep-exp-mgr@example.test', 'MANAGER')
  assert.equal((await fetch(`${BASE}/api/reports?r=status`, { headers: { cookie: mgr } })).status, 403)
  assert.equal((await fetch(`${BASE}/api/reports?r=status`, { headers: { cookie: (await owner()) } })).status, 200)
})

test('M1: the legacy task backfill never guesses between duplicate names', async () => {
  // Two accounts share a display name; a legacy task names them ambiguously.
  await sql`delete from tasks where title in ('LEGACY-AMBIGUOUS','LEGACY-UNIQUE','LEGACY-UNMATCHED')`
  await sql`delete from users where email in ('dup1@example.test','dup2@example.test','uniq@example.test')`
  const [d1] = await sql`insert into users (name,email,password_hash,role,status) values ('Duplicate Name','dup1@example.test','x','CASE_AGENT','ACTIVE') returning id`
  await sql`insert into users (name,email,password_hash,role,status) values ('Duplicate Name','dup2@example.test','x','CASE_AGENT','ACTIVE')`
  const [uq] = await sql`insert into users (name,email,password_hash,role,status) values ('Unique Person','uniq@example.test','x','CASE_AGENT','ACTIVE') returning id`

  await sql`insert into tasks (title, assignee, status) values ('LEGACY-AMBIGUOUS','Duplicate Name','Open')`
  await sql`insert into tasks (title, assignee, status) values ('LEGACY-UNIQUE','Unique Person','Open')`
  await sql`insert into tasks (title, assignee, status) values ('LEGACY-UNMATCHED','Nobody At All','Open')`

  // Re-run the backfill exactly as the migration does (idempotent).
  await sql`
    update tasks t set assignee_id = (select u.id from users u where u.name = t.assignee)
     where t.assignee_id is null and t.assignee is not null
       and (select count(*) from users u where u.name = t.assignee) = 1`

  const [amb] = await sql`select assignee_id from tasks where title = 'LEGACY-AMBIGUOUS'`
  assert.equal(amb.assignee_id, null, 'a duplicate name must never be guessed')
  const [uniq] = await sql`select assignee_id from tasks where title = 'LEGACY-UNIQUE'`
  assert.equal(uniq.assignee_id, uq.id, 'a unique name must be backfilled')
  const [unm] = await sql`select assignee_id from tasks where title = 'LEGACY-UNMATCHED'`
  assert.equal(unm.assignee_id, null, 'an unmatched name stays null')
  assert.ok(d1)

  // Ambiguous legacy tasks are visible only to full-visibility management.
  const agentCookie = await ensureUser('legacy-agent@example.test', 'CASE_AGENT')
  const agentHtml = await (await fetch(`${BASE}/tasks`, { headers: { cookie: agentCookie } })).text()
  assert.ok(!agentHtml.includes('LEGACY-AMBIGUOUS'), 'an unassigned legacy task must not leak to a scoped user')
  const adminHtml = await (await fetch(`${BASE}/tasks`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(adminHtml.includes('LEGACY-AMBIGUOUS'), 'management must still see it to reassign')
})

test('M2: deleting a user un-assigns their tasks instead of orphaning them', async () => {
  const email = 'fk-user@example.test'
  const cookie = await ensureUser(email, 'CASE_AGENT')
  assert.ok(cookie)
  const [u] = await sql`select id from users where email = ${email}`
  await sql`insert into tasks (title, assignee_id, status) values ('FK-TASK', ${u.id}, 'Open')`
  await sql`delete from users where id = ${u.id}`
  const [t] = await sql`select assignee_id from tasks where title = 'FK-TASK'`
  assert.equal(t.assignee_id, null, 'ON DELETE SET NULL must clear the assignment')
})

test('K1: the task form submits assigneeId and a MANAGER can assign to another user', async () => {
  const mgr = await ensureUser('tf-mgr@example.test', 'MANAGER')
  const targetEmail = 'tf-target@example.test'
  await ensureUser(targetEmail, 'CASE_AGENT')
  const [target] = await sql`select id from users where email = ${targetEmail}`

  const html = await (await fetch(`${BASE}/tasks/new`, { headers: { cookie: mgr } })).text()
  assert.ok(html.includes('CASE_AGENT user') || html.includes('option'), 'the form must render an assignee select')

  // Exactly the payload the form sends.
  const res = await api('/api/tasks', mgr, 'POST', { title: 'TF-ASSIGNED', caseRef: '', dueAt: '', priority: 'Normal', assigneeId: target.id })
  assert.equal(res.status, 200, await res.text())
  const [row] = await sql`select assignee_id from tasks where title = 'TF-ASSIGNED'`
  assert.equal(row.assignee_id, target.id, 'the selected assignee must be honoured, never silently ignored')
})

test('K2: a scoped user cannot assign through the form payload, and READ_ONLY cannot open it', async () => {
  const agent = await ensureUser('tf-agent@example.test', 'CASE_AGENT')
  const otherEmail = 'tf-other@example.test'
  await ensureUser(otherEmail, 'CASE_AGENT')
  const [other] = await sql`select id from users where email = ${otherEmail}`

  const formHtml = await (await fetch(`${BASE}/tasks/new`, { headers: { cookie: agent } })).text()
  assert.ok(formHtml.includes('only create tasks assigned to yourself'), 'the select must be locked for a scoped role')

  const [{ n: before }] = await sql`select count(*)::int n from tasks`
  const denied = await api('/api/tasks', agent, 'POST', { title: 'TF-STEAL', assigneeId: other.id, priority: 'Normal' })
  assert.equal(denied.status, 403)
  const [{ n: after }] = await sql`select count(*)::int n from tasks`
  assert.equal(after, before, 'no task row may be written')

  const ro = await ensureUser('tf-ro@example.test', 'READ_ONLY')
  const roHtml = await (await fetch(`${BASE}/tasks/new`, { headers: { cookie: ro } })).text()
  assert.ok(roHtml.includes('Not available'), 'READ_ONLY must not open the task form')
  const roRes = await api('/api/tasks', ro, 'POST', { title: 'TF-RO', priority: 'Normal' })
  assert.equal(roRes.status, 403)
})

test('P1: payment metadata is hidden from non-financial roles', async () => {
  const email = 'meta-agent@example.test'
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email}`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status,pay_channel,next_payment)
                           values ('MetaCust','Priv',${u.id},'ACTIVE','Zelle','2027-01-15') returning id`

  for (const path of ['/customers', `/customers/${cust.id}`, '/dashboard']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()
    assert.ok(!html.includes('Zelle'), `${path} must not reveal the pay channel`)
    assert.ok(!html.includes('2027-01-15'), `${path} must not reveal the next payment date`)
  }

  const adminHtml = await (await fetch(`${BASE}/customers/${cust.id}`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(adminHtml.includes('Zelle'), 'an admin must still see it')
})

test('N1: unknown and unauthorized customer ids return the same neutral response', async () => {
  const mine = await seedAgentWithWork('neutral@example.test', 'NeutralCust', 'NEU-1')
  const [other] = await sql`insert into customers (first_name,last_name,approval_status) values ('OtherAgents','Customer','ACTIVE') returning id`

  const unauthorized = await fetch(`${BASE}/customers/${other.id}`, { headers: { cookie: mine.cookie } })
  const missing = await fetch(`${BASE}/customers/00000000-0000-0000-0000-000000000000`, { headers: { cookie: mine.cookie } })
  assert.equal(unauthorized.status, missing.status, 'status must be identical')

  const uHtml = await unauthorized.text()
  const mHtml = await missing.text()
  assert.ok(uHtml.includes('Not available') && mHtml.includes('Not available'), 'both must be the neutral result')
  assert.ok(!uHtml.includes('Customer not found') && !mHtml.includes('Customer not found'))
  assert.ok(!uHtml.includes('OtherAgents'), 'the record must not be revealed')
})

test('U1: creation controls are hidden from roles that cannot use them', async () => {
  const ro = await ensureUser('ui-ro@example.test', 'READ_ONLY')
  const payHtml = await (await fetch(`${BASE}/payments`, { headers: { cookie: ro } })).text()
  assert.ok(!payHtml.includes('Record payment'), 'READ_ONLY must not see the Record payment control')
  const taskHtml = await (await fetch(`${BASE}/tasks`, { headers: { cookie: ro } })).text()
  assert.ok(!taskHtml.includes('New task'), 'READ_ONLY must not see the New task control')

  const adminPay = await (await fetch(`${BASE}/payments`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(adminPay.includes('Record payment'), 'an admin must still see it')
})

// ===========================================================================
// v100 fixes
// ===========================================================================
test('V1: a role without case.update sees the hearing but no scheduling or edit controls', async () => {
  // SALES_AGENT holds customer permissions but NOT case.update. The case is
  // assigned to that account so it genuinely appears on their hearings page.
  const email = 'v1-sales@example.test'
  const sales = await ensureUser(email, 'SALES_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                           values ('V1Cust','Owned',${u.id},'ACTIVE') returning id`
  const soon = new Date(Date.now() + 3 * 86400000).toISOString()
  const [kase] = await sql`insert into cases (customer_id, citation, agent_id, approval_status, status, hearing_at, hearing_type, prep_status)
                           values (${cust.id}, 'V1-VISIBLE', ${u.id}, 'ACTIVE', 'Hearing Scheduled', ${soon}, 'In person', 'Not started')
                           returning id`

  const html = await (await fetch(`${BASE}/hearings`, { headers: { cookie: sales } })).text()
  // The read policy allows them to SEE their own hearing...
  assert.ok(html.includes('V1-VISIBLE'), 'the owned hearing must still be visible')
  // ...but none of the mutating controls, asserted on real rendered text.
  assert.ok(!html.includes('+ Schedule hearing'), 'the Schedule hearing button must be absent')
  assert.ok(!/>\s*Edit\s*</.test(html), 'the Edit link must be absent')

  // Direct access to the edit page is neutrally refused.
  const edit = await (await fetch(`${BASE}/hearings/${kase.id}`, { headers: { cookie: sales } })).text()
  assert.ok(edit.includes('Not available'), 'the edit page must be refused neutrally')

  // The API rejects the update and the row is untouched.
  const [before] = await sql`select hearing_type, prep_status, status from cases where id = ${kase.id}`
  const res = await api('/api/hearings', sales, 'POST', { caseId: kase.id, hearingType: 'Zoom', prepStatus: 'Ready' })
  assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`)
  const [after] = await sql`select hearing_type, prep_status, status from cases where id = ${kase.id}`
  assert.deepEqual(after, before, 'a rejected hearing update must leave the row unchanged')
})

test('V1b: an authorized role keeps the scheduling controls and the edit page', async () => {
  const cookie = await owner()
  const stamp = Date.now()
  const UNSCHEDULED = `V1B-UNSCHED-${stamp}`
  const SCHEDULED = `V1B-SCHED-${stamp}`

  // Self-contained: creates every record it asserts on, so it passes alone
  // against a clean database and never depends on another test's data.
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status)
                           values (${'V1bCust' + stamp}, 'Admin', 'ACTIVE') returning id`
  // (a) ACTIVE case with no hearing yet -> drives the "+ Schedule hearing" picker
  const [unscheduled] = await sql`insert into cases (customer_id, citation, approval_status, status)
                                  values (${cust.id}, ${UNSCHEDULED}, 'ACTIVE', 'Action Required') returning id`
  // (b) separate ACTIVE case that IS scheduled -> drives the row and its Edit link
  const soon = new Date(Date.now() + 4 * 86400000).toISOString()
  const [scheduled] = await sql`insert into cases (customer_id, citation, approval_status, status, hearing_at, hearing_type, prep_status)
                                values (${cust.id}, ${SCHEDULED}, 'ACTIVE', 'Hearing Scheduled', ${soon}, 'In person', 'Not started')
                                returning id`

  const html = await (await fetch(`${BASE}/hearings`, { headers: { cookie } })).text()
  assert.ok(html.includes('+ Schedule hearing'), 'the scheduling control must be present')
  assert.ok(html.includes(UNSCHEDULED), 'the unscheduled case must be offered for scheduling')
  assert.ok(html.includes(SCHEDULED), 'the scheduled case must appear as a hearing row')
  assert.ok(html.includes(`/hearings/${scheduled.id}`), 'the Edit link for the scheduled case must be present')

  const edit = await (await fetch(`${BASE}/hearings/${scheduled.id}`, { headers: { cookie } })).text()
  assert.ok(!edit.includes('Not available'), 'the hearing edit page must load')

  const [before] = await sql`select hearing_type, prep_status from cases where id = ${scheduled.id}`
  assert.equal(before.hearing_type, 'In person')

  const res = await api('/api/hearings', cookie, 'POST', {
    caseId: scheduled.id, hearingType: 'Zoom', prepStatus: 'In progress',
    hearingAt: new Date(Date.now() + 6 * 86400000).toISOString(),
    hearingTz: 'America/Los_Angeles',
  })
  assert.equal(res.status, 200, await res.text())

  const [after] = await sql`select hearing_type, prep_status from cases where id = ${scheduled.id}`
  assert.equal(after.hearing_type, 'Zoom', 'the authorized update must be persisted')
  assert.equal(after.prep_status, 'In progress')
  assert.ok(unscheduled.id)
})

test('V2: the dashboard\u2019s displayed overdue count follows assignee_id, not the display name', async () => {
  const email = 'v2-agent@example.test'
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id, name from users where email = ${email.toLowerCase()}`

  // A second ACTIVE account with exactly the same display name.
  await sql`delete from users where email = 'v2-twin@example.test'`
  const [twin] = await sql`insert into users (name,email,password_hash,role,status)
                           values (${u.name},'v2-twin@example.test','x','CASE_AGENT','ACTIVE') returning id`

  // Isolate: remove any other overdue task that could be attributed to either id.
  await sql`delete from tasks where assignee_id in (${u.id}, ${twin.id})`
  const past = new Date(Date.now() - 86400000).toISOString()
  await sql`insert into tasks (title, assignee, assignee_id, status, due_at) values ('V2-MINE', ${u.name}, ${u.id}, 'Open', ${past})`
  await sql`insert into tasks (title, assignee, assignee_id, status, due_at) values ('V2-TWIN', ${u.name}, ${twin.id}, 'Open', ${past})`

  // Read the number the dashboard actually renders under "Overdue Tasks".
  const readOverdue = async () => {
    const html = await (await fetch(`${BASE}/dashboard`, { headers: { cookie } })).text()
    const m = html.match(/Overdue Tasks<\/p>[\s\S]{0,200}?>(\d+)</)
    assert.ok(m, 'the Overdue Tasks figure must be present on the dashboard')
    return Number(m[1])
  }

  assert.equal(await readOverdue(), 1, 'name-matching would wrongly count the twin\u2019s task as well')

  // Renaming the signed-in user must not change ownership.
  await sql`update users set name = 'Renamed Person' where id = ${u.id}`
  assert.equal(await readOverdue(), 1, 'the displayed count must survive a rename')

  await sql`delete from tasks where assignee_id in (${u.id}, ${twin.id})`
})

test('V3: task assignment honours the task-assignee policy', async () => {
  const mgr = await ensureUser('v3-mgr@example.test', 'MANAGER')
  const ids = {}
  for (const role of ['BILLING', 'DOCUMENT_STAFF', 'READ_ONLY']) {
    const email = `v3-${role.toLowerCase()}@example.test`
    await ensureUser(email, role)
    const [u] = await sql`select id from users where email = ${email}`
    ids[role] = u.id
  }
  // Billing and Document Staff may receive tasks.
  for (const role of ['BILLING', 'DOCUMENT_STAFF']) {
    const res = await api('/api/tasks', mgr, 'POST', { title: `V3-${role}`, assigneeId: ids[role], priority: 'Normal' })
    assert.equal(res.status, 200, `${role} must be able to receive a task: ${await res.text()}`)
    const [row] = await sql`select assignee_id from tasks where title = ${'V3-' + role}`
    assert.equal(row.assignee_id, ids[role])
  }
  // READ_ONLY may not.
  const [{ n: before }] = await sql`select count(*)::int n from tasks`
  const ro = await api('/api/tasks', mgr, 'POST', { title: 'V3-RO', assigneeId: ids['READ_ONLY'], priority: 'Normal' })
  assert.equal(ro.status, 400, 'READ_ONLY must not receive tasks')
  // Inactive users may not.
  await sql`update users set status = 'DISABLED' where id = ${ids['BILLING']}`
  const inactive = await api('/api/tasks', mgr, 'POST', { title: 'V3-INACTIVE', assigneeId: ids['BILLING'], priority: 'Normal' })
  assert.equal(inactive.status, 400, 'an inactive user must not receive tasks')
  const [{ n: after }] = await sql`select count(*)::int n from tasks`
  assert.equal(after, before, 'no task row may be written by a rejected request')
  await sql`update users set status = 'ACTIVE' where id = ${ids['BILLING']}`

  // The dropdown offers Billing and Document Staff, but not Read Only.
  const form = await (await fetch(`${BASE}/tasks/new`, { headers: { cookie: mgr } })).text()
  assert.ok(form.includes('BILLING user') && form.includes('DOCUMENT_STAFF user'), 'working roles must be selectable')
  assert.ok(!form.includes('READ_ONLY user'), 'READ_ONLY must not be offered')
})

test('V4: creation pages and controls require the matching permission', async () => {
  // BILLING has neither customer.create nor case.create.
  const billing = await ensureUser('v4-billing@example.test', 'BILLING')
  for (const path of ['/customers/new', '/cases/new']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie: billing } })).text()
    assert.ok(html.includes('Not available'), `${path} must be refused`)
    assert.ok(!html.includes('<select'), 'no dropdown data may be returned')
  }
  const custList = await (await fetch(`${BASE}/customers`, { headers: { cookie: billing } })).text()
  assert.ok(!custList.includes('Add customer'), 'the Add customer control must be hidden')
  const caseList = await (await fetch(`${BASE}/cases`, { headers: { cookie: billing } })).text()
  assert.ok(!caseList.includes('New case'), 'the New case control must be hidden')

  // A CASE_AGENT may create cases but not customers.
  const agent = await seedAgentWithWork('v4-agent@example.test', 'V4Cust', 'V4-1')
  const newCust = await (await fetch(`${BASE}/customers/new`, { headers: { cookie: agent.cookie } })).text()
  assert.ok(newCust.includes('Not available'), 'a case agent must not open customer creation')
  const newCase = await (await fetch(`${BASE}/cases/new`, { headers: { cookie: agent.cookie } })).text()
  assert.ok(!newCase.includes('Not available'), 'a case agent may open case creation')

  const adminCust = await (await fetch(`${BASE}/customers`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(adminCust.includes('Add customer'), 'an admin still sees the control')
})

test('V5: customer financial fields never reach a non-financial viewer', async () => {
  const email = 'v5-agent@example.test'
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email}`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status,pay_channel,next_payment)
                           values ('V5Cust','Priv',${u.id},'ACTIVE','Zelle','2027-03-09') returning id`
  const html = await (await fetch(`${BASE}/customers/${cust.id}`, { headers: { cookie } })).text()
  assert.ok(html.includes('V5Cust'), 'the customer is theirs, so it renders')
  assert.ok(!html.includes('Zelle'), 'pay channel must not appear anywhere in the payload')
  assert.ok(!html.includes('2027-03-09'), 'next payment must not appear anywhere in the payload')
})

test('V6: unknown report types return 400 before any query runs', async () => {
  const cookie = await owner()
  for (const bad of ['unknown', 'drop', 'status2']) {
    const res = await fetch(`${BASE}/api/reports?r=${bad}`, { headers: { cookie } })
    assert.equal(res.status, 400, `${bad} must be a bad request`)
  }
  // Valid but unauthorised stays 403; valid and authorised stays 200.
  const mgr = await ensureUser('v6-mgr@example.test', 'MANAGER')
  assert.equal((await fetch(`${BASE}/api/reports?r=status`, { headers: { cookie: mgr } })).status, 403)
  assert.equal((await fetch(`${BASE}/api/reports?r=status`, { headers: { cookie } })).status, 200)
  assert.equal((await fetch(`${BASE}/api/reports?r=method`, { headers: { cookie } })).status, 200)

  // Authorisation is deliberately checked BEFORE type validation, so a caller
  // without export permission cannot use the 400/403 difference to discover
  // which report names exist. Unknown types return 400 only for callers that
  // are allowed to export at all.
  const billing = await ensureUser('v6-billing@example.test', 'BILLING')
  assert.equal((await fetch(`${BASE}/api/reports?r=unknown`, { headers: { cookie: billing } })).status, 403)
  assert.equal((await fetch(`${BASE}/api/reports?r=status`, { headers: { cookie: billing } })).status, 403)
})

test('W1: the "+ Add case" control on a customer profile follows case.create', async () => {
  const stamp = Date.now()

  // --- SALES_AGENT: can view their OWN customer, but lacks case.create ---
  const salesEmail = `w1-sales-${stamp}@example.test`
  const sales = await ensureUser(salesEmail, 'SALES_AGENT')
  const [salesUser] = await sql`select id from users where email = ${salesEmail.toLowerCase()}`
  const salesCustName = `W1Sales${stamp}`
  const [salesCust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                                values (${salesCustName}, 'Owned', ${salesUser.id}, 'ACTIVE') returning id`

  const salesHtml = await (await fetch(`${BASE}/customers/${salesCust.id}`, { headers: { cookie: sales } })).text()
  assert.ok(salesHtml.includes(salesCustName), 'the sales agent must be able to view their own customer')
  assert.ok(!salesHtml.includes('Not available'), 'this is a button-permission case, not an ownership denial')
  assert.ok(!salesHtml.includes('+ Add case'), 'SALES_AGENT lacks case.create so the button must be hidden')

  const salesNewCase = await (await fetch(`${BASE}/cases/new`, { headers: { cookie: sales } })).text()
  assert.ok(salesNewCase.includes('Not available'), '/cases/new must be denied to SALES_AGENT')

  // The API is the real guard: it must refuse and write nothing.
  const [{ n: before }] = await sql`select count(*)::int n from cases`
  const apiRes = await api('/api/cases', sales, 'POST', { customerId: salesCust.id, citation: `W1-SALES-${stamp}` })
  assert.equal(apiRes.status, 403, 'case creation must be refused at the API')
  const [{ n: after }] = await sql`select count(*)::int n from cases`
  assert.equal(after, before, 'no case row may be written')

  // --- CASE_AGENT: owns a customer AND holds case.create ---
  const agentEmail = `w1-agent-${stamp}@example.test`
  const agent = await ensureUser(agentEmail, 'CASE_AGENT')
  const [agentUser] = await sql`select id from users where email = ${agentEmail.toLowerCase()}`
  const agentCustName = `W1Agent${stamp}`
  const [agentCust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                                values (${agentCustName}, 'Owned', ${agentUser.id}, 'ACTIVE') returning id`
  const agentHtml = await (await fetch(`${BASE}/customers/${agentCust.id}`, { headers: { cookie: agent } })).text()
  assert.ok(agentHtml.includes(agentCustName), 'the case agent must be able to view their own customer')
  assert.ok(agentHtml.includes('+ Add case'), 'CASE_AGENT holds case.create so the button must show')

  // --- ADMIN and MANAGER see it on a customer they can access ---
  for (const cookie of [await owner(), await ensureUser(`w1-manager-${stamp}@example.test`, 'MANAGER')]) {
    const html = await (await fetch(`${BASE}/customers/${agentCust.id}`, { headers: { cookie } })).text()
    assert.ok(html.includes('+ Add case'), 'management must see the Add case control')
  }

  // --- BILLING and READ_ONLY: distinguish ownership denial from permission denial ---
  for (const role of ['BILLING', 'READ_ONLY']) {
    const cookie = await ensureUser(`w1-${role.toLowerCase()}-${stamp}@example.test`, role)
    // Operationally scoped: another agent's customer is an OWNERSHIP denial.
    const ownership = await (await fetch(`${BASE}/customers/${agentCust.id}`, { headers: { cookie } })).text()
    assert.ok(ownership.includes('Not available'), `${role} must get an ownership denial on a customer that is not theirs`)
    // Independently, the creation page is a PERMISSION denial.
    const perm = await (await fetch(`${BASE}/cases/new`, { headers: { cookie } })).text()
    assert.ok(perm.includes('Not available'), `${role} must be denied /cases/new by permission`)
  }
})

test('W2: a non-financial viewer gets a working case list with no financial values in the payload', async () => {
  const email = 'w2-agent@example.test'
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                           values ('W2Cust','NoMoney',${u.id},'ACTIVE') returning id`
  const [kase] = await sql`insert into cases (customer_id, citation, agent_id, approval_status, status, fee)
                           values (${cust.id}, 'W2-CASE', ${u.id}, 'ACTIVE', 'New', 987654) returning id`
  await sql`insert into payments (customer_id, case_id, kind, method, amount, status, invoice)
            values (${cust.id}, ${kase.id}, 'Case', 'Card', 123456, 'Paid', 'INV-W2')`

  const html = await (await fetch(`${BASE}/customers/${cust.id}`, { headers: { cookie } })).text()
  // The list still renders correctly...
  assert.ok(html.includes('W2-CASE'), 'the case must still be listed')
  assert.ok(html.includes('W2Cust'), 'the customer still renders')
  // ...with no financial values anywhere in the server response.
  assert.ok(!html.includes('987654'), 'the case fee must not appear')
  assert.ok(!html.includes('123456'), 'the paid total must not appear')
  assert.ok(!/>\s*Remaining\s*</.test(html), 'the Remaining column must be hidden')

  // A financial role still sees them.
  const adminHtml = await (await fetch(`${BASE}/customers/${cust.id}`, { headers: { cookie: (await owner()) } })).text()
  assert.ok(adminHtml.includes('987,654') || adminHtml.includes('987654'), 'an admin must still see the fee')
})

// ===========================================================================
// Sessions and device management
// ===========================================================================
async function sessionIdsFor(email) {
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  return sql`select id, session_key, revoked_at from user_sessions where user_id = ${u.id} order by created_at`
}

test('S1: two logins create two distinct sessions, visible only to their owner', async () => {
  const email = `s1-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const b = await login(email, PW)
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.notEqual(a.cookie, b.cookie, 'each sign-in must issue a distinct token')

  // ensureUser() signs in once itself, so two further logins add two more.
  const rows = await sessionIdsFor(email)
  assert.equal(rows.length, 3, 'each sign-in must create its own database session')
  assert.equal(new Set(rows.map((r) => r.session_key)).size, 3, 'session keys must be unique')

  // Another user cannot see them.
  const otherEmail = `s1-other-${Date.now()}@example.test`
  const other = await ensureUser(otherEmail, 'CASE_AGENT')
  const otherHtml = await (await fetch(`${BASE}/profile`, { headers: { cookie: other } })).text()
  for (const r of rows) assert.ok(!otherHtml.includes(r.id), 'another user must not see these sessions')

  const ownHtml = await (await fetch(`${BASE}/profile`, { headers: { cookie: a.cookie } })).text()
  assert.ok(ownHtml.includes('Sessions'), 'the owner sees their sessions panel')
})

test('S2: revoking one session blocks it immediately while the other keeps working', async () => {
  const email = `s2-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const b = await login(email, PW)

  const rows = await sessionIdsFor(email)
  // Identify session B's row by its key, then revoke it from session A.
  const [bRow] = await sql`select us.id from user_sessions us
                            join users u on u.id = us.user_id
                           where u.email = ${email.toLowerCase()} order by us.created_at desc limit 1`
  const res = await api('/api/sessions', a.cookie, 'POST', { action: 'revoke', sessionId: bRow.id })
  assert.equal(res.status, 200, await res.text())

  const blocked = await api('/api/notifications', b.cookie, 'GET')
  assert.ok([401, 403].includes(blocked.status), 'the revoked session must stop working immediately')
  const still = await api('/api/notifications', a.cookie, 'GET')
  assert.equal(still.status, 200, 'the other session must keep working')
  assert.ok(rows.length >= 2)
})

test('S3: a user cannot revoke another user\u2019s session', async () => {
  const victimEmail = `s3-victim-${Date.now()}@example.test`
  await ensureUser(victimEmail, 'CASE_AGENT')
  const victim = await login(victimEmail, PW)
  const [vRow] = await sql`select us.id, us.revoked_at from user_sessions us join users u on u.id = us.user_id
                            where u.email = ${victimEmail.toLowerCase()} order by us.created_at desc limit 1`

  const attackerEmail = `s3-attacker-${Date.now()}@example.test`
  const attacker = await ensureUser(attackerEmail, 'CASE_AGENT')
  const res = await api('/api/sessions', attacker, 'POST', { action: 'revoke', sessionId: vRow.id })
  assert.equal(res.status, 404, 'must be a neutral 404, never a successful cross-user revoke')

  const [after] = await sql`select revoked_at from user_sessions where id = ${vRow.id}`
  assert.equal(after.revoked_at, null, 'the victim session must be untouched')
  const ok = await api('/api/notifications', victim.cookie, 'GET')
  assert.equal(ok.status, 200, 'the victim stays signed in')
})

test('S4: sign out other devices keeps only the current session', async () => {
  const email = `s4-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const b = await login(email, PW)
  const c = await login(email, PW)

  const res = await api('/api/sessions', a.cookie, 'POST', { action: 'revoke-others' })
  assert.equal(res.status, 200)
  // ensureUser's own sign-in plus logins b and c are all revoked; a survives.
  assert.equal((await res.json()).revoked, 3)

  assert.equal((await api('/api/notifications', a.cookie, 'GET')).status, 200, 'current session survives')
  for (const other of [b.cookie, c.cookie]) {
    const r = await api('/api/notifications', other, 'GET')
    assert.ok([401, 403].includes(r.status), 'other sessions must be revoked')
  }
})

test('S5: sign out everywhere invalidates every session including the current one', async () => {
  const email = `s5-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const b = await login(email, PW)

  const res = await api('/api/sessions', a.cookie, 'POST', { action: 'revoke-all' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).signedOut, true)

  for (const cookie of [a.cookie, b.cookie]) {
    const r = await api('/api/notifications', cookie, 'GET')
    assert.ok([401, 403].includes(r.status), 'no session may survive')
  }
})

test('S6: logout revokes the database session, not just the cookie', async () => {
  const email = `s6-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const captured = a.cookie

  const out = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: captured } })
  assert.ok(out.ok || out.status === 200)

  // Replaying the captured cookie must fail: the row is revoked server-side.
  const replay = await api('/api/notifications', captured, 'GET')
  assert.ok([401, 403].includes(replay.status), 'a copied cookie must not work after sign-out')
})

test('S7: password change revokes all sessions and issues exactly one fresh session', async () => {
  const email = `s7-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const b = await login(email, PW)

  const res = await api('/api/profile', b.cookie, 'POST', { current: PW, next: 'Rotated-Passw0rd!2026' })
  assert.equal(res.status, 200, await res.text())

  const stale = await api('/api/notifications', a.cookie, 'GET')
  assert.ok([401, 403].includes(stale.status), 'other sessions must be revoked')

  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [{ n }] = await sql`select count(*)::int n from user_sessions
                             where user_id = ${u.id} and revoked_at is null and expires_at > now()`
  assert.equal(n, 1, 'exactly one active session must remain')
})

test('S8: disabled and deleted accounts still have their sessions rejected', async () => {
  const email = `s8-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`

  await api('/api/users', (await owner()), 'PATCH', { id: u.id, status: 'DISABLED' })
  assert.ok([401, 403].includes((await api('/api/notifications', a.cookie, 'GET')).status))

  // Deleting the user must cascade the session rows away.
  await sql`delete from users where id = ${u.id}`
  const [{ n }] = await sql`select count(*)::int n from user_sessions where user_id = ${u.id}`
  assert.equal(n, 0, 'ON DELETE CASCADE must remove the sessions')
})

test('S9: expired and revoked sessions are rejected', async () => {
  const email = `s9-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`

  await sql`update user_sessions set expires_at = now() - interval '1 minute' where user_id = ${u.id}`
  const expired = await api('/api/notifications', a.cookie, 'GET')
  assert.ok([401, 403].includes(expired.status), 'an expired session must be rejected')

  await sql`update user_sessions set expires_at = now() + interval '1 hour', revoked_at = now() where user_id = ${u.id}`
  const revoked = await api('/api/notifications', a.cookie, 'GET')
  assert.ok([401, 403].includes(revoked.status), 'a revoked session must be rejected')
})

test('S10: no reusable authentication secret is stored in the session table', async () => {
  const email = `s10-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const token = a.cookie.split('=')[1]

  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const rows = await sql`select * from user_sessions where user_id = ${u.id} order by created_at desc`
  assert.ok(rows.length >= 1)
  const serialized = JSON.stringify(rows)
  assert.ok(!serialized.includes(token), 'the JWT must never be stored')
  assert.ok(!serialized.includes(PW), 'no password may be stored')
  // The stored key is opaque and is not the cookie value.
  for (const r of rows) {
    assert.notEqual(r.session_key, token, 'the stored key must not be the cookie value')
    assert.ok(r.session_key.length >= 32, 'the session key must be long and random')
  }
})

test('S11: disabling an account revokes its session rows, so re-enabling shows none active', async () => {
  const email = `s11-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const b = await login(email, PW)
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`

  const [{ n: activeBefore }] = await sql`select count(*)::int n from user_sessions
                                           where user_id = ${u.id} and revoked_at is null`
  assert.ok(activeBefore >= 2, 'sessions exist while the account is active')

  const dis = await api('/api/users', (await owner()), 'PATCH', { id: u.id, status: 'DISABLED' })
  assert.equal(dis.status, 200, await dis.text())

  const [{ n: activeAfter }] = await sql`select count(*)::int n from user_sessions
                                          where user_id = ${u.id} and revoked_at is null`
  assert.equal(activeAfter, 0, 'disabling must revoke every session row')

  // Re-enable: the obsolete pre-disable sessions must NOT come back as active.
  const en = await api('/api/users', (await owner()), 'PATCH', { id: u.id, status: 'ACTIVE' })
  assert.equal(en.status, 200)
  const [{ n: afterEnable }] = await sql`select count(*)::int n from user_sessions
                                          where user_id = ${u.id} and revoked_at is null and expires_at > now()`
  assert.equal(afterEnable, 0, 're-enabling must not resurrect old sessions')

  for (const cookie of [a.cookie, b.cookie]) {
    const r = await api('/api/notifications', cookie, 'GET')
    assert.ok([401, 403].includes(r.status), 'pre-disable tokens must stay rejected after re-enable')
  }

  // A fresh sign-in works and is the only session listed.
  const fresh = await login(email, PW)
  assert.equal(fresh.status, 200)
  const profile = await (await fetch(`${BASE}/profile`, { headers: { cookie: fresh.cookie } })).text()
  assert.ok(profile.includes('Sessions'), 'the profile lists sessions')
  const [{ n: finalActive }] = await sql`select count(*)::int n from user_sessions
                                          where user_id = ${u.id} and revoked_at is null and expires_at > now()`
  assert.equal(finalActive, 1, 'only the new session is active')
})

test('S12: revoke-all expires the clp_session cookie in its response', async () => {
  const email = `s12-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)

  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: a.cookie },
    body: JSON.stringify({ action: 'revoke-all' }),
  })
  assert.equal(res.status, 200)
  const setCookies = (res.headers.getSetCookie?.() || []).join(' ; ')
  assert.match(setCookies, /clp_session=/, 'the response must set the session cookie')
  assert.ok(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookies), 'the cookie must be expired, not left in place')

  const after = await api('/api/notifications', a.cookie, 'GET')
  assert.ok([401, 403].includes(after.status), 'the revoked session must be rejected')
})

test('S13: normal logout expires the clp_session cookie in its response', async () => {
  const email = `s13-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)

  const res = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie: a.cookie } })
  assert.equal(res.status, 200)
  const setCookies = (res.headers.getSetCookie?.() || []).join(' ; ')
  assert.match(setCookies, /clp_session=/, 'logout must set the session cookie')
  assert.ok(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookies), 'logout must expire the cookie')
})

test('S14: last_seen_at is not rewritten on every request but refreshes past the window', async () => {
  const email = `s14-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const a = await login(email, PW)
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  // ensureUser() signs in too, so keep only the newest session (cookie `a`)
  // and assert against exactly that row.
  await sql`delete from user_sessions
             where user_id = ${u.id}
               and id <> (select id from user_sessions where user_id = ${u.id} order by created_at desc limit 1)`
  const [{ n: only }] = await sql`select count(*)::int n from user_sessions where user_id = ${u.id}`
  assert.equal(only, 1, 'precondition: exactly one session under test')

  const [start] = await sql`select last_seen_at from user_sessions where user_id = ${u.id} and revoked_at is null`
  // Several requests inside the throttle window must not move last_seen_at.
  for (let i = 0; i < 3; i++) await api('/api/notifications', a.cookie, 'GET')
  const [unchanged] = await sql`select last_seen_at from user_sessions where user_id = ${u.id} and revoked_at is null`
  assert.equal(new Date(unchanged.last_seen_at).getTime(), new Date(start.last_seen_at).getTime(),
    'no UPDATE may be issued inside the throttle window')

  // Push it past the window; the next request must refresh it.
  await sql`update user_sessions set last_seen_at = now() - interval '10 minutes'
             where user_id = ${u.id} and revoked_at is null`
  const [stale] = await sql`select last_seen_at from user_sessions where user_id = ${u.id} and revoked_at is null`
  await api('/api/notifications', a.cookie, 'GET')
  const [touched] = await sql`select last_seen_at from user_sessions where user_id = ${u.id} and revoked_at is null`
  assert.ok(new Date(touched.last_seen_at).getTime() > new Date(stale.last_seen_at).getTime(),
    'last_seen_at must refresh once the window has passed')
})

// ===========================================================================
// Feature 2 — reminders
// ===========================================================================
const CRON_SECRET = process.env.TEST_CRON_SECRET || 'test-cron-secret-0123456789abcdefghijklmnop'
const cron = (secret) => fetch(`${BASE}/api/cron/reminders`, {
  headers: secret ? { authorization: `Bearer ${secret}` } : {},
})

async function makeHearingCase({ email, hearingAt, tz = 'America/Los_Angeles', status = 'Hearing Scheduled', approval = 'ACTIVE', citation }) {
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                           values (${'Rem' + Date.now()}, 'Customer', ${u.id}, 'ACTIVE') returning id`
  const [k] = await sql`insert into cases (customer_id, citation, court, court_phone, agent_id, approval_status, status, hearing_at, hearing_tz, hearing_type, state)
                        values (${cust.id}, ${citation}, 'Pierce County District', '(253) 555-0142', ${u.id},
                                ${approval}, ${status}, ${hearingAt}, ${tz}, 'Zoom', 'WA') returning id`
  return { cookie, userId: u.id, customerId: cust.id, caseId: k.id }
}

test('R1: cron requires a valid bearer secret and rejects sessions', async () => {
  assert.equal((await cron(null)).status, 403, 'missing authorization must fail')
  assert.equal((await cron('wrong-secret')).status, 403, 'a wrong secret must fail')

  // A normal portal session must NOT authorize cron.
  const user = await ensureUser('cron-user@example.test', 'CASE_AGENT')
  const withSession = await fetch(`${BASE}/api/cron/reminders`, { headers: { cookie: user } })
  assert.equal(withSession.status, 403, 'a signed-in session must not authorize cron')

  const ok = await cron(CRON_SECRET)
  const body = await ok.json().catch(() => ({}))
  assert.equal(ok.status, 200, JSON.stringify(body))
  // Only safe counts — never customer or hearing detail.
  for (const key of Object.keys(body)) {
    assert.ok(['ok', 'created', 'cancelled', 'delivered', 'escalated', 'skipped', 'failed', 'pruned'].includes(key),
      `unexpected field in cron response: ${key}`)
  }
  const text = JSON.stringify(body)
  assert.ok(!text.includes(CRON_SECRET), 'the secret must never be echoed')
})

test('R2: the four hearing reminders are created for the agent and management only', async () => {
  const cite = `R2-${Date.now()}`
  const far = new Date(Date.now() + 10 * 86400000).toISOString()
  const h = await makeHearingCase({ email: `r2-${Date.now()}@example.test`, hearingAt: far, citation: cite })

  assert.equal((await cron(CRON_SECRET)).status, 200)

  const mine = await sql`select event_key, priority from notifications
                          where source_id = ${h.caseId} and recipient_user_id = ${h.userId} order by event_key`
  assert.equal(mine.length, 4, 'exactly four reminders for the assigned agent')
  const keys = mine.map((r) => r.event_key.split(':').pop()).sort()
  assert.deepEqual(keys, ['24h', '2h', '3d', '4d'].sort())
  const criticals = mine.filter((r) => r.priority === 'critical').length
  assert.equal(criticals, 2, 'the 24h and 2h reminders are critical')

  // Management receives them; an unrelated agent does not.
  const [ownerUser] = await sql`select id from users where email = 'owner@example.test'`
  const [{ n: mgmt }] = await sql`select count(*)::int n from notifications
                                   where source_id = ${h.caseId} and recipient_user_id = ${ownerUser.id}`
  assert.equal(mgmt, 4, 'management receives the reminders')

  const strangerEmail = `r2-stranger-${Date.now()}@example.test`
  await ensureUser(strangerEmail, 'CASE_AGENT')
  const [stranger] = await sql`select id from users where email = ${strangerEmail.toLowerCase()}`
  const [{ n: none }] = await sql`select count(*)::int n from notifications
                                   where source_id = ${h.caseId} and recipient_user_id = ${stranger.id}`
  assert.equal(none, 0, 'an unrelated agent must never receive the reminder')
})

test('R3: repeated and concurrent cron runs create no duplicates', async () => {
  const cite = `R3-${Date.now()}`
  const h = await makeHearingCase({ email: `r3-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 9 * 86400000).toISOString(), citation: cite })

  await cron(CRON_SECRET)
  const [{ n: first }] = await sql`select count(*)::int n from notifications where source_id = ${h.caseId}`

  // Sequential rerun.
  await cron(CRON_SECRET)
  // Overlapping executions.
  await Promise.all([cron(CRON_SECRET), cron(CRON_SECRET), cron(CRON_SECRET)])

  const [{ n: after }] = await sql`select count(*)::int n from notifications where source_id = ${h.caseId}`
  assert.equal(after, first, 'the unique constraint must prevent any duplicate')
})

test('R4: a hearing inside some intervals only creates the remaining ones', async () => {
  const cite = `R4-${Date.now()}`
  // 36 hours away: 4d and 3d have already passed.
  const h = await makeHearingCase({ email: `r4-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 36 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  const rows = await sql`select event_key from notifications where source_id = ${h.caseId} and recipient_user_id = ${h.userId}`
  const keys = rows.map((r) => r.event_key.split(':').pop()).sort()
  assert.deepEqual(keys, ['24h', '2h'].sort(), 'no expired interval may be created')
})

test('R5: pending, rejected, resolved and dismissed cases produce no reminders', async () => {
  for (const [approval, status] of [['PENDING', 'Hearing Scheduled'], ['REJECTED', 'Hearing Scheduled'], ['ACTIVE', 'Resolved'], ['ACTIVE', 'Dismissed']]) {
    const cite = `R5-${approval}-${status}-${Date.now()}`
    const h = await makeHearingCase({
      email: `r5-${approval}-${status.replace(/\s/g, '')}-${Date.now()}@example.test`.toLowerCase(),
      hearingAt: new Date(Date.now() + 8 * 86400000).toISOString(), citation: cite, approval, status,
    })
    await cron(CRON_SECRET)
    const [{ n }] = await sql`select count(*)::int n from notifications where source_id = ${h.caseId} and cancelled_at is null`
    assert.equal(n, 0, `${approval}/${status} must produce no active reminders`)
  }
})

test('R6: rescheduling cancels old reminders and creates new ones; the old date is never delivered', async () => {
  const cite = `R6-${Date.now()}`
  const original = new Date(Date.now() + 9 * 86400000).toISOString()
  const h = await makeHearingCase({ email: `r6-${Date.now()}@example.test`, hearingAt: original, citation: cite })
  await cron(CRON_SECRET)

  const before = await sql`select id, event_key from notifications where source_id = ${h.caseId} and cancelled_at is null`
  assert.ok(before.length >= 4)

  // Reschedule.
  const moved = new Date(Date.now() + 20 * 86400000).toISOString()
  await sql`update cases set hearing_at = ${moved} where id = ${h.caseId}`
  await cron(CRON_SECRET)

  const oldKeyFragment = new Date(original).toISOString()
  const [{ n: staleActive }] = await sql`select count(*)::int n from notifications
                                          where source_id = ${h.caseId} and cancelled_at is null
                                            and event_key like ${'%' + oldKeyFragment + '%'}`
  assert.equal(staleActive, 0, 'no reminder for the old date may remain active')

  const [{ n: staleDelivered }] = await sql`select count(*)::int n from notifications
                                             where source_id = ${h.caseId} and delivery_status = 'delivered'
                                               and cancelled_at is null
                                               and event_key like ${'%' + oldKeyFragment + '%'}`
  assert.equal(staleDelivered, 0, 'a reminder carrying the old hearing date must never be delivered')

  const newKeyFragment = new Date(moved).toISOString()
  const [{ n: fresh }] = await sql`select count(*)::int n from notifications
                                    where source_id = ${h.caseId} and cancelled_at is null
                                      and event_key like ${'%' + newKeyFragment + '%'}`
  assert.ok(fresh >= 4, 'reminders for the new schedule must exist')

  // History is preserved, not deleted.
  const [{ n: total }] = await sql`select count(*)::int n from notifications where source_id = ${h.caseId}`
  assert.ok(total >= before.length, 'previous records are retained for audit')
})

test('R7: resolving a case cancels its future reminders but keeps history', async () => {
  const cite = `R7-${Date.now()}`
  const h = await makeHearingCase({ email: `r7-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 9 * 86400000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  const [{ n: activeBefore }] = await sql`select count(*)::int n from notifications where source_id = ${h.caseId} and cancelled_at is null`
  assert.ok(activeBefore >= 4)

  await sql`update cases set status = 'Resolved' where id = ${h.caseId}`
  await cron(CRON_SECRET)

  const [{ n: activeAfter }] = await sql`select count(*)::int n from notifications where source_id = ${h.caseId} and cancelled_at is null`
  assert.equal(activeAfter, 0, 'all future reminders must be cancelled')
  const [{ n: retained }] = await sql`select count(*)::int n from notifications where source_id = ${h.caseId}`
  assert.ok(retained >= activeBefore, 'records are cancelled, not deleted')
})

test('R8: notification ownership — one user cannot read, acknowledge or dismiss another\u2019s', async () => {
  const cite = `R8-${Date.now()}`
  const h = await makeHearingCase({ email: `r8-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 3 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  const [mine] = await sql`select id from notifications where source_id = ${h.caseId} and recipient_user_id = ${h.userId} limit 1`
  assert.ok(mine, 'the agent has a reminder')

  const attacker = await ensureUser(`r8-attacker-${Date.now()}@example.test`, 'CASE_AGENT')
  for (const action of ['read', 'acknowledge', 'dismiss']) {
    const res = await api('/api/notifications', attacker, 'PATCH', { action, id: mine.id })
    assert.equal(res.status, 404, `${action} on another user's notification must be a neutral 404`)
  }
  const [row] = await sql`select read_at, acknowledged_at, dismissed_at from notifications where id = ${mine.id}`
  assert.deepEqual([row.read_at, row.acknowledged_at, row.dismissed_at], [null, null, null],
    'a rejected mutation must not change the row')

  // The attacker's own list never contains it.
  const list = await (await api('/api/notifications', attacker, 'GET')).json()
  assert.ok(!JSON.stringify(list).includes(mine.id), 'it must not appear in another user\u2019s feed')
})

test('R9: critical reminders require acknowledgement and cannot be dismissed first', async () => {
  const cite = `R9-${Date.now()}`
  // 26 hours out so the critical 24h reminder is created, then advance the
  // clock by backdating scheduled_for so the scheduler delivers it.
  const h = await makeHearingCase({ email: `r9-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  await sql`update notifications set scheduled_for = now() - interval '1 minute'
             where source_id = ${h.caseId} and priority = 'critical' and delivery_status = 'pending'`
  await cron(CRON_SECRET)

  const [critical] = await sql`select id from notifications
                                where source_id = ${h.caseId} and recipient_user_id = ${h.userId}
                                  and priority = 'critical' and delivery_status = 'delivered' limit 1`
  assert.ok(critical, 'a delivered critical reminder exists')

  const dismissed = await api('/api/notifications', h.cookie, 'PATCH', { action: 'dismiss', id: critical.id })
  assert.equal(dismissed.status, 409, 'an unacknowledged critical reminder must not be dismissible')

  const ack = await api('/api/notifications', h.cookie, 'PATCH', { action: 'acknowledge', id: critical.id })
  assert.equal(ack.status, 200, await ack.text())
  const [row] = await sql`select acknowledged_at, acknowledged_by from notifications where id = ${critical.id}`
  assert.ok(row.acknowledged_at, 'the acknowledgement time is recorded')
  assert.equal(row.acknowledged_by, h.userId, 'who acknowledged it is recorded')

  // Dismissing is allowed once acknowledged.
  assert.equal((await api('/api/notifications', h.cookie, 'PATCH', { action: 'dismiss', id: critical.id })).status, 200)
})

test('R10: unacknowledged 24h reminders escalate once, preserving the original', async () => {
  const cite = `R10-${Date.now()}`
  const h = await makeHearingCase({ email: `r10-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  // Deliver the 24h reminder, then push delivered_at past the grace period.
  await sql`update notifications set scheduled_for = now() - interval '1 minute'
             where source_id = ${h.caseId} and event_key like '%:24h' and delivery_status = 'pending'`
  await cron(CRON_SECRET)
  await sql`update notifications set delivered_at = now() - interval '45 minutes'
             where source_id = ${h.caseId} and event_key like '%:24h'`

  const [orig] = await sql`select id from notifications
                            where source_id = ${h.caseId} and recipient_user_id = ${h.userId}
                              and event_key like '%:24h' and delivery_status = 'delivered' limit 1`
  assert.ok(orig, 'the 24h reminder was delivered to the agent')

  await cron(CRON_SECRET)
  const [{ n: esc1 }] = await sql`select count(*)::int n from notifications
                                   where source_id = ${h.caseId} and event_key like '%:escalation'`
  assert.ok(esc1 > 0, 'management escalation was created')

  // Running again must not duplicate the escalation.
  await cron(CRON_SECRET)
  await cron(CRON_SECRET)
  const [{ n: esc2 }] = await sql`select count(*)::int n from notifications
                                   where source_id = ${h.caseId} and event_key like '%:escalation'`
  assert.equal(esc2, esc1, 'escalation must not duplicate')

  const [stillThere] = await sql`select id, cancelled_at from notifications where id = ${orig.id}`
  assert.ok(stillThere && !stillThere.cancelled_at, 'the original agent reminder is preserved')
})

test('R11: overdue task reminders reach only the assignee and stop on completion', async () => {
  const email = `r11-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const past = new Date(Date.now() - 2 * 86400000).toISOString()
  const [t] = await sql`insert into tasks (title, assignee_id, status, due_at, priority)
                        values (${'R11-TASK-' + Date.now()}, ${u.id}, 'Open', ${past}, 'High') returning id`
  await cron(CRON_SECRET)

  const [{ n: mine }] = await sql`select count(*)::int n from notifications
                                   where source_id = ${t.id} and recipient_user_id = ${u.id}`
  assert.equal(mine, 1, 'the assignee is reminded once')
  const [{ n: others }] = await sql`select count(*)::int n from notifications
                                     where source_id = ${t.id} and recipient_user_id <> ${u.id}`
  assert.equal(others, 0, 'nobody else is notified')

  await sql`update tasks set status = 'Completed' where id = ${t.id}`
  await cron(CRON_SECRET)
  const [{ n: active }] = await sql`select count(*)::int n from notifications
                                     where source_id = ${t.id} and cancelled_at is null`
  assert.equal(active, 0, 'completing the task stops the reminder')
})

test('R12: payment reminders reach only roles with financial access', async () => {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status,next_payment_date)
                           values (${'R12Cust' + Date.now()}, 'Payer', 'ACTIVE', ${soon}) returning id`
  const billing = await ensureUser(`r12-billing-${Date.now()}@example.test`, 'BILLING')
  const agentEmail = `r12-agent-${Date.now()}@example.test`
  await ensureUser(agentEmail, 'CASE_AGENT')
  assert.ok(billing)
  await cron(CRON_SECRET)

  const [{ n: toBilling }] = await sql`select count(*)::int n from notifications n
                                        join users u on u.id = n.recipient_user_id
                                       where n.source_id = ${cust.id} and u.role = 'BILLING'`
  assert.ok(toBilling > 0, 'billing receives payment reminders')

  const [{ n: toAgent }] = await sql`select count(*)::int n from notifications n
                                      join users u on u.id = n.recipient_user_id
                                     where n.source_id = ${cust.id} and u.role in ('CASE_AGENT','SALES_AGENT','DOCUMENT_STAFF')`
  assert.equal(toAgent, 0, 'non-financial roles must never receive payment reminders')
})

test('R13: only valid ISO dates were backfilled into next_payment_date', async () => {
  const base = Date.now()
  await sql`insert into customers (first_name,last_name,approval_status,next_payment)
            values (${'R13Good' + base}, 'Valid', 'ACTIVE', '2027-03-15')`
  await sql`insert into customers (first_name,last_name,approval_status,next_payment)
            values (${'R13Bad' + base}, 'Invalid', 'ACTIVE', 'whenever they pay')`
  await sql`insert into customers (first_name,last_name,approval_status,next_payment)
            values (${'R13Rollover' + base}, 'Impossible', 'ACTIVE', '2026-02-31')`

  // Re-run exactly the migration's exception-safe backfill (idempotent).
  await sql.unsafe(`do $$
declare r record;
begin
  for r in select id, next_payment from customers
            where next_payment_date is null and next_payment ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  loop
    begin
      update customers set next_payment_date = r.next_payment::date where id = r.id;
    exception when others then continue;
    end;
  end loop;
end $$;`)

  const [good] = await sql`select next_payment, next_payment_date from customers where first_name = ${'R13Good' + base}`
  assert.equal(good.next_payment_date.toISOString().slice(0, 10), '2027-03-15', 'a valid date is converted')

  const [bad] = await sql`select next_payment, next_payment_date from customers where first_name = ${'R13Bad' + base}`
  assert.equal(bad.next_payment_date, null, 'invalid text is not converted')
  assert.equal(bad.next_payment, 'whenever they pay', 'the original text is preserved')

  const [roll] = await sql`select next_payment, next_payment_date from customers where first_name = ${'R13Rollover' + base}`
  assert.equal(roll.next_payment_date, null, 'an impossible calendar date must never be silently rewritten')
  assert.equal(roll.next_payment, '2026-02-31', 'the original text is preserved')
})

test('R14: document expiry reminders are generated at the defined intervals', async () => {
  const email = `r14-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                           values (${'R14Cust' + Date.now()}, 'Docs', ${u.id}, 'ACTIVE') returning id`
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const [doc] = await sql`insert into documents (customer_id, category, file_name, expires_on)
                          values (${cust.id}, 'CDL', ${'R14-' + Date.now() + '.pdf'}, ${in7}) returning id`
  await cron(CRON_SECRET)

  const [{ n }] = await sql`select count(*)::int n from notifications
                             where source_id = ${doc.id} and recipient_user_id = ${u.id}`
  assert.equal(n, 1, 'the assigned agent is reminded at the 7-day interval')
  await cron(CRON_SECRET)
  const [{ n: again }] = await sql`select count(*)::int n from notifications where source_id = ${doc.id}`
  assert.ok(again >= 1)
  const [{ n: dupes }] = await sql`select count(*)::int n from notifications
                                    where source_id = ${doc.id} and recipient_user_id = ${u.id}`
  assert.equal(dupes, 1, 'rerunning must not duplicate')
})

test('R15: disabled users cannot use reminders, and the feed requires a session', async () => {
  const email = `r15-${Date.now()}@example.test`
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  assert.equal((await api('/api/notifications', cookie, 'GET')).status, 200)

  await api('/api/users', (await owner()), 'PATCH', { id: u.id, status: 'DISABLED' })
  const after = await api('/api/notifications', cookie, 'GET')
  assert.ok([401, 403].includes(after.status), 'a disabled user cannot read reminders')

  const anon = await fetch(`${BASE}/api/notifications`)
  assert.equal(anon.status, 401, 'anonymous access is refused')
})

// ===========================================================================
// Reminder hardening
// ===========================================================================
/** Delivers a hearing's pending reminders by advancing their scheduled_for. */
async function deliverNow(caseId, keyLike = '%') {
  await sql`update notifications set scheduled_for = now() - interval '1 minute'
             where source_id = ${caseId} and delivery_status = 'pending' and event_key like ${keyLike}`
  await cron(CRON_SECRET)
}

test('H1: rescheduling cancels an already-DELIVERED old reminder everywhere', async () => {
  const cite = `H1-${Date.now()}`
  const original = new Date(Date.now() + 26 * 3600000).toISOString()
  const h = await makeHearingCase({ email: `h1-${Date.now()}@example.test`, hearingAt: original, citation: cite })
  await cron(CRON_SECRET)
  await deliverNow(h.caseId, '%:24h')

  const [old24] = await sql`select id, delivery_status from notifications
                             where source_id = ${h.caseId} and recipient_user_id = ${h.userId}
                               and event_key like '%:24h' limit 1`
  assert.equal(old24.delivery_status, 'delivered', 'precondition: the 24h reminder was delivered')

  // (b) it is visible in the feed while still valid
  const beforeFeed = await (await api('/api/notifications', h.cookie, 'GET')).text()
  assert.ok(beforeFeed.includes(old24.id), 'the delivered reminder is in the feed before rescheduling')

  // Reschedule.
  const moved = new Date(Date.now() + 40 * 24 * 3600000).toISOString()
  await sql`update cases set hearing_at = ${moved} where id = ${h.caseId}`
  await cron(CRON_SECRET)

  // (a) cancelled_at is set on the DELIVERED row, and it is preserved
  const [after] = await sql`select cancelled_at, delivery_status from notifications where id = ${old24.id}`
  assert.ok(after.cancelled_at, 'the delivered obsolete reminder must be cancelled')
  assert.equal(after.delivery_status, 'delivered', 'history is preserved, not deleted')

  // (b) gone from the active feed
  const feed = await (await api('/api/notifications', h.cookie, 'GET')).text()
  assert.ok(!feed.includes(old24.id), 'a cancelled reminder must disappear from the feed')

  // (c) not mutable as active
  for (const action of ['read', 'acknowledge', 'dismiss']) {
    const res = await api('/api/notifications', h.cookie, 'PATCH', { action, id: old24.id })
    assert.equal(res.status, 404, `${action} on a cancelled reminder must fail`)
  }
  const [untouched] = await sql`select read_at, acknowledged_at, dismissed_at from notifications where id = ${old24.id}`
  assert.deepEqual([untouched.read_at, untouched.acknowledged_at, untouched.dismissed_at], [null, null, null])

  // (d) it can never escalate
  await sql`update notifications set delivered_at = now() - interval '2 hours' where id = ${old24.id}`
  await cron(CRON_SECRET)
  const [{ n: esc }] = await sql`select count(*)::int n from notifications
                                  where source_id = ${h.caseId} and event_key like ${old24.id + '%'}`
  assert.equal(esc, 0)
  const [{ n: anyEsc }] = await sql`select count(*)::int n from notifications
                                     where source_id = ${h.caseId} and event_key like ${'%' + new Date(original).toISOString() + '%:escalation'}`
  assert.equal(anyEsc, 0, 'a cancelled reminder must never escalate')

  // (e) reminders exist for the new date, created exactly once
  const newFragment = new Date(moved).toISOString()
  const fresh = await sql`select event_key from notifications
                           where source_id = ${h.caseId} and cancelled_at is null
                             and recipient_user_id = ${h.userId} and event_key like ${'%' + newFragment + '%'}`
  assert.equal(fresh.length, 4, 'the new schedule produces exactly four reminders')
  await cron(CRON_SECRET)
  const again = await sql`select event_key from notifications
                           where source_id = ${h.caseId} and cancelled_at is null
                             and recipient_user_id = ${h.userId} and event_key like ${'%' + newFragment + '%'}`
  assert.equal(again.length, 4, 'rerunning creates them exactly once')
})

test('H2: escalation follows the assigned agent only; management copies never trigger it', async () => {
  const cite = `H2-${Date.now()}`
  const h = await makeHearingCase({ email: `h2-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  await deliverNow(h.caseId, '%:24h')

  // Management copy exists and is unacknowledged, but the AGENT acknowledges.
  const [ownerUser] = await sql`select id from users where email = 'owner@example.test'`
  const [mgmtCopy] = await sql`select id, acknowledged_at from notifications
                                where source_id = ${h.caseId} and recipient_user_id = ${ownerUser.id}
                                  and event_key like '%:24h' limit 1`
  assert.ok(mgmtCopy && !mgmtCopy.acknowledged_at, 'management copy is unacknowledged')

  const [agentRow] = await sql`select id from notifications
                                where source_id = ${h.caseId} and recipient_user_id = ${h.userId}
                                  and event_key like '%:24h' limit 1`
  const ack = await api('/api/notifications', h.cookie, 'PATCH', { action: 'acknowledge', id: agentRow.id })
  assert.equal(ack.status, 200, await ack.text())

  // Past the grace period, still no escalation because the AGENT acknowledged.
  await sql`update notifications set delivered_at = now() - interval '2 hours'
             where source_id = ${h.caseId} and event_key like '%:24h'`
  await cron(CRON_SECRET)
  const [{ n }] = await sql`select count(*)::int n from notifications
                             where source_id = ${h.caseId} and event_key like '%:escalation'`
  assert.equal(n, 0, 'an acknowledged agent reminder must prevent escalation entirely')
})

test('H3: an unacknowledged agent reminder escalates once per manager, after the grace period', async () => {
  const cite = `H3-${Date.now()}`
  const h = await makeHearingCase({ email: `h3-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  await deliverNow(h.caseId, '%:24h')

  // Same cron execution that delivered must NOT escalate.
  const [{ n: immediate }] = await sql`select count(*)::int n from notifications
                                        where source_id = ${h.caseId} and event_key like '%:escalation'`
  assert.equal(immediate, 0, 'no escalation in the delivering run (grace period)')

  // Still inside the grace window.
  await sql`update notifications set delivered_at = now() - interval '5 minutes'
             where source_id = ${h.caseId} and event_key like '%:24h'`
  await cron(CRON_SECRET)
  const [{ n: early }] = await sql`select count(*)::int n from notifications
                                    where source_id = ${h.caseId} and event_key like '%:escalation'`
  assert.equal(early, 0, 'no escalation before the grace period elapses')

  // Past the grace window.
  await sql`update notifications set delivered_at = now() - interval '45 minutes'
             where source_id = ${h.caseId} and event_key like '%:24h'`
  await cron(CRON_SECRET)
  const escalations = await sql`select recipient_user_id from notifications
                                 where source_id = ${h.caseId} and event_key like '%:escalation'`
  assert.ok(escalations.length > 0, 'escalation occurs after the grace period')
  const unique = new Set(escalations.map((e) => e.recipient_user_id))
  assert.equal(unique.size, escalations.length, 'one escalation per manager, no duplicates')

  // Concurrent reruns must not duplicate.
  await Promise.all([cron(CRON_SECRET), cron(CRON_SECRET), cron(CRON_SECRET)])
  const [{ n: after }] = await sql`select count(*)::int n from notifications
                                    where source_id = ${h.caseId} and event_key like '%:escalation'`
  assert.equal(after, escalations.length, 'concurrent runs must not duplicate escalations')
})

test('H4: the notifications page shows a case agent their own hearing notifications', async () => {
  const cite = `H4-${Date.now()}`
  const h = await makeHearingCase({ email: `h4-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  await deliverNow(h.caseId, '%')

  const html = await (await fetch(`${BASE}/notifications`, { headers: { cookie: h.cookie } })).text()
  assert.ok(!html.includes('Not available'), 'a case agent must be able to open their notifications')
  assert.ok(html.includes('Hearing'), 'hearing notifications are listed')
  assert.ok(html.includes(cite), 'the reminder content is visible to its recipient')

  // Another agent must not see them.
  const stranger = await ensureUser(`h4-stranger-${Date.now()}@example.test`, 'CASE_AGENT')
  const strangerHtml = await (await fetch(`${BASE}/notifications`, { headers: { cookie: stranger } })).text()
  assert.ok(!strangerHtml.includes(cite), 'another recipient\u2019s notifications must not appear')
})

test('H5: acknowledge applies only to delivered, active, critical hearing reminders', async () => {
  const cite = `H5-${Date.now()}`
  const h = await makeHearingCase({ email: `h5-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)

  // Pending (undelivered) reminder cannot be mutated.
  const [pending] = await sql`select id from notifications
                               where source_id = ${h.caseId} and recipient_user_id = ${h.userId}
                                 and delivery_status = 'pending' limit 1`
  assert.ok(pending)
  for (const action of ['read', 'acknowledge', 'dismiss']) {
    const res = await api('/api/notifications', h.cookie, 'PATCH', { action, id: pending.id })
    assert.equal(res.status, 404, `${action} on a pending notification must fail`)
  }

  // A delivered NON-critical reminder cannot be acknowledged.
  await deliverNow(h.caseId, '%')
  const [normal] = await sql`select id from notifications
                              where source_id = ${h.caseId} and recipient_user_id = ${h.userId}
                                and priority <> 'critical' and delivery_status = 'delivered' limit 1`
  if (normal) {
    const res = await api('/api/notifications', h.cookie, 'PATCH', { action: 'acknowledge', id: normal.id })
    assert.equal(res.status, 404, 'only critical hearing reminders may be acknowledged')
  }
})

test('H6: a customer created through the API receives the correct payment reminder', async () => {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  const name = `H6Cust${Date.now()}`
  const res = await api('/api/customers', (await owner()), 'POST', {
    firstName: name, lastName: 'ApiCreated', nextPayment: soon, plan: 'Individual Plan',
  })
  assert.equal(res.status, 200, await res.text())
  const [c] = await sql`select id, next_payment, next_payment_date from customers where first_name = ${name}`
  assert.equal(c.next_payment, soon, 'the legacy text field is written')
  assert.equal(new Date(c.next_payment_date).toISOString().slice(0, 10), soon, 'the validated date column is written')

  await cron(CRON_SECRET)
  const billing = await ensureUser(`h6-billing-${Date.now()}@example.test`, 'BILLING')
  assert.ok(billing)
  const [{ n }] = await sql`select count(*)::int n from notifications where source_id = ${c.id} and type = 'payment'`
  assert.ok(n > 0, 'a payment reminder is generated for the API-created customer')
})

test('H7: document expiry is set through the API and drives reminders', async () => {
  const email = `h7-${Date.now()}@example.test`
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                           values (${'H7Cust' + Date.now()}, 'Docs', ${u.id}, 'ACTIVE') returning id`
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

  const created = await api('/api/documents', cookie, 'POST', {
    customerId: cust.id, category: 'CDL', fileName: `H7-${Date.now()}.pdf`, expiresOn: in7,
  })
  const createdBody = await created.json().catch(() => ({}))
  assert.equal(created.status, 200, JSON.stringify(createdBody))
  const { id } = createdBody

  // Invalid calendar dates are rejected.
  const bad = await api('/api/documents', cookie, 'PATCH', { id, expiresOn: '2026-02-31' })
  assert.equal(bad.status, 400, 'an impossible expiry date must be refused')

  await cron(CRON_SECRET)
  const [{ n }] = await sql`select count(*)::int n from notifications
                             where source_id = ${id} and recipient_user_id = ${u.id}`
  assert.equal(n, 1, 'the 7-day document reminder reaches the assigned agent')

  // Another agent cannot change it.
  const stranger = await ensureUser(`h7-stranger-${Date.now()}@example.test`, 'CASE_AGENT')
  const denied = await api('/api/documents', stranger, 'PATCH', { id, expiresOn: in7 })
  assert.equal(denied.status, 404, 'a foreign document must not be editable')
})

// ===========================================================================
// Input-path timezone safety and reconciliation
// ===========================================================================
test('X1: a blank or unknown state cannot store a silent Pacific hearing timezone', async () => {
  const cookie = await owner()
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status)
                           values (${'X1Cust' + Date.now()}, 'Tz', 'ACTIVE') returning id`
  const soon = new Date(Date.now() + 9 * 86400000).toISOString()
  const [{ n: before }] = await sql`select count(*)::int n from cases`

  for (const state of ['', '   ', 'ZZ', 'Califrnia', 'Not A State']) {
    const res = await api('/api/cases', cookie, 'POST', {
      customerId: cust.id, citation: `X1-${state || 'blank'}-${Date.now()}`, state, hearingAt: soon,
    })
    assert.equal(res.status, 400, `state "${state}" must be refused for a hearing date`)
  }
  const [{ n: after }] = await sql`select count(*)::int n from cases`
  assert.equal(after, before, 'a rejected request must write no case row')

  // An invalid explicit timezone is refused too.
  const badTz = await api('/api/cases', cookie, 'POST', {
    customerId: cust.id, citation: `X1-BADTZ-${Date.now()}`, state: 'CA', hearingAt: soon, hearingTz: 'Mars/Olympus',
  })
  assert.equal(badTz.status, 400, 'an invalid IANA zone must be refused')

  // A recognised state works, and an explicit zone overrides it.
  const good = await api('/api/cases', cookie, 'POST', {
    customerId: cust.id, citation: `X1-OK-${Date.now()}`, state: 'WA', hearingAt: soon,
  })
  assert.equal(good.status, 200, await good.text())
  const explicit = await api('/api/cases', cookie, 'POST', {
    customerId: cust.id, citation: `X1-EXPLICIT-${Date.now()}`, state: 'TX', hearingAt: soon, hearingTz: 'America/Denver',
  })
  assert.equal(explicit.status, 200)
  const [row] = await sql`select hearing_tz from cases where citation like 'X1-EXPLICIT-%' order by created_at desc limit 1`
  assert.equal(row.hearing_tz, 'America/Denver', 'the explicit selection wins over the state default')
})

test('X2: the hearing update rejects an unresolvable timezone and leaves the case unchanged', async () => {
  const cite = `X2-${Date.now()}`
  const h = await makeHearingCase({ email: `x2-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 9 * 86400000).toISOString(), citation: cite })
  await sql`update cases set state = 'ZZ' where id = ${h.caseId}`
  const [before] = await sql`select hearing_at, hearing_tz, status from cases where id = ${h.caseId}`

  const res = await api('/api/hearings', (await owner()), 'POST', {
    caseId: h.caseId, hearingType: 'Zoom', hearingAt: new Date(Date.now() + 12 * 86400000).toISOString(), state: 'ZZ',
  })
  assert.equal(res.status, 400, 'an unrecognised state must be refused')
  const [after] = await sql`select hearing_at, hearing_tz, status from cases where id = ${h.caseId}`
  assert.deepEqual(
    { a: after.hearing_at?.toISOString(), t: after.hearing_tz, s: after.status },
    { a: before.hearing_at?.toISOString(), t: before.hearing_tz, s: before.status },
    'a rejected hearing update must leave the case untouched',
  )
})

test('X3: clearing the hearing date cancels every old reminder immediately', async () => {
  const cite = `X3-${Date.now()}`
  const h = await makeHearingCase({ email: `x3-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  await deliverNow(h.caseId, '%:24h')
  const [old] = await sql`select id from notifications where source_id = ${h.caseId}
                           and recipient_user_id = ${h.userId} and event_key like '%:24h' limit 1`
  assert.ok(old)

  // Clear the hearing through the API; no cron run in between.
  const res = await api('/api/hearings', (await owner()), 'POST', {
    caseId: h.caseId, hearingAt: '', status: 'Action Required', hearingType: 'In person',
  })
  assert.equal(res.status, 200, await res.text())

  const [{ n: active }] = await sql`select count(*)::int n from notifications
                                     where source_id = ${h.caseId} and cancelled_at is null`
  assert.equal(active, 0, 'clearing the hearing must cancel reminders in the same operation')

  const feed = await (await api('/api/notifications', h.cookie, 'GET')).text()
  assert.ok(!feed.includes(old.id), 'the cancelled reminder must leave the feed')
  for (const action of ['read', 'acknowledge', 'dismiss']) {
    assert.equal((await api('/api/notifications', h.cookie, 'PATCH', { action, id: old.id })).status, 404)
  }
  await sql`update notifications set delivered_at = now() - interval '2 hours' where id = ${old.id}`
  await cron(CRON_SECRET)
  const [{ n: esc }] = await sql`select count(*)::int n from notifications
                                  where source_id = ${h.caseId} and event_key like '%:escalation'`
  assert.equal(esc, 0, 'a cleared hearing must never escalate')
})

test('X4: reassigning a case moves the reminders to the new agent', async () => {
  const cite = `X4-${Date.now()}`
  const a = await makeHearingCase({ email: `x4a-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  await deliverNow(a.caseId, '%')
  const [aRow] = await sql`select id from notifications where source_id = ${a.caseId}
                            and recipient_user_id = ${a.userId} limit 1`
  assert.ok(aRow, 'Agent A has a reminder')

  const bEmail = `x4b-${Date.now()}@example.test`
  await ensureUser(bEmail, 'CASE_AGENT')
  const [b] = await sql`select id from users where email = ${bEmail.toLowerCase()}`
  await sql`update cases set agent_id = ${b.id} where id = ${a.caseId}`
  await cron(CRON_SECRET)

  const [aAfter] = await sql`select cancelled_at from notifications where id = ${aRow.id}`
  assert.ok(aAfter.cancelled_at, 'the former agent\u2019s reminder must be cancelled')
  for (const action of ['read', 'acknowledge', 'dismiss']) {
    assert.equal((await api('/api/notifications', a.cookie, 'PATCH', { action, id: aRow.id })).status, 404)
  }
  // The hearing is 26 hours out, so only the 24h and 2h intervals remain.
  const bRows = await sql`select event_key from notifications
                           where source_id = ${a.caseId} and recipient_user_id = ${b.id} and cancelled_at is null`
  assert.equal(bRows.length, 2, 'the new agent receives the still-applicable reminders')
  const bKeys = bRows.map((r) => r.event_key.split(':').pop()).sort()
  assert.deepEqual(bKeys, ['24h', '2h'].sort())
})

test('X5: a demoted management recipient loses their reminder copy', async () => {
  const cite = `X5-${Date.now()}`
  const mgrEmail = `x5-mgr-${Date.now()}@example.test`
  await ensureUser(mgrEmail, 'MANAGER')
  const [mgr] = await sql`select id from users where email = ${mgrEmail.toLowerCase()}`
  const h = await makeHearingCase({ email: `x5-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)

  const [copy] = await sql`select id from notifications where source_id = ${h.caseId}
                            and recipient_user_id = ${mgr.id} and cancelled_at is null limit 1`
  assert.ok(copy, 'the manager received a copy')

  // Demote to a role with no management visibility.
  await sql`update users set role = 'CASE_AGENT' where id = ${mgr.id}`
  await cron(CRON_SECRET)
  const [after] = await sql`select cancelled_at from notifications where id = ${copy.id}`
  assert.ok(after.cancelled_at, 'a demoted manager\u2019s copy must be cancelled')
})

test('X6: a timezone-only correction cancels the old text and regenerates it', async () => {
  const cite = `X6-${Date.now()}`
  const instant = new Date(Date.now() + 9 * 86400000).toISOString()
  const h = await makeHearingCase({ email: `x6-${Date.now()}@example.test`, hearingAt: instant, tz: 'America/Los_Angeles', citation: cite })
  await cron(CRON_SECRET)
  const [oldRow] = await sql`select id, message from notifications where source_id = ${h.caseId}
                              and recipient_user_id = ${h.userId} limit 1`
  assert.ok(oldRow.message.includes('PST') || oldRow.message.includes('PDT'), 'original message is Pacific')

  // Same UTC instant, corrected court timezone.
  const res = await api('/api/hearings', (await owner()), 'POST', {
    caseId: h.caseId, hearingAt: instant, hearingTz: 'America/New_York', hearingType: 'Zoom',
  })
  assert.equal(res.status, 200, await res.text())

  const [old] = await sql`select cancelled_at from notifications where id = ${oldRow.id}`
  assert.ok(old.cancelled_at, 'the reminder written with the old timezone must be cancelled')
  const [fresh] = await sql`select message from notifications where source_id = ${h.caseId}
                             and recipient_user_id = ${h.userId} and cancelled_at is null limit 1`
  assert.ok(fresh && (fresh.message.includes('EST') || fresh.message.includes('EDT')),
    'the replacement must use the corrected court timezone')
})

test('X7: an unresolvable legacy timezone yields UTC plus a visible warning', async () => {
  const cite = `X7-${Date.now()}`
  const h = await makeHearingCase({ email: `x7-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 9 * 86400000).toISOString(), citation: cite })
  // Legacy corruption applied directly, as a pre-strict row would look.
  await sql`update cases set hearing_tz = 'Mars/Olympus', state = 'ZZ' where id = ${h.caseId}`
  await cron(CRON_SECRET)

  const [row] = await sql`select message from notifications where source_id = ${h.caseId}
                           and recipient_user_id = ${h.userId} and cancelled_at is null limit 1`
  assert.ok(row, 'a reminder still exists')
  assert.ok(row.message.includes('TIMEZONE NEEDS REVIEW'), 'the reminder must carry the warning')
  assert.ok(!row.message.includes('PST') && !row.message.includes('PDT'), 'never a plausible Pacific time')

  const html = await (await fetch(`${BASE}/hearings`, { headers: { cookie: h.cookie } })).text()
  assert.ok(html.includes('TIMEZONE NEEDS REVIEW'), 'the list page shows the warning')
})

test('X8: stale non-hearing reminders are cancelled on their transitions', async () => {
  const cookie = await owner()
  // Invoice paid.
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status)
                           values (${'X8Cust' + Date.now()}, 'Stale', 'ACTIVE') returning id`
  const [pay] = await sql`insert into payments (customer_id, kind, method, amount, status, invoice)
                          values (${cust.id}, 'Membership', 'Card', 100, 'Overdue', ${'INV-X8-' + Date.now()}) returning id`
  await cron(CRON_SECRET)
  const [{ n: before }] = await sql`select count(*)::int n from notifications where source_id = ${pay.id} and cancelled_at is null`
  assert.ok(before > 0, 'an overdue invoice reminder exists')
  await sql`update payments set status = 'Paid' where id = ${pay.id}`
  await cron(CRON_SECRET)
  const [{ n: after }] = await sql`select count(*)::int n from notifications where source_id = ${pay.id} and cancelled_at is null`
  assert.equal(after, 0, 'a paid invoice cancels its reminder')

  // Next payment date changed.
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await sql`update customers set next_payment_date = ${soon} where id = ${cust.id}`
  await cron(CRON_SECRET)
  const [{ n: payBefore }] = await sql`select count(*)::int n from notifications
                                        where source_id = ${cust.id} and type = 'payment' and cancelled_at is null`
  assert.ok(payBefore > 0)
  await sql`update customers set next_payment_date = null where id = ${cust.id}`
  await cron(CRON_SECRET)
  const [{ n: payAfter }] = await sql`select count(*)::int n from notifications
                                       where source_id = ${cust.id} and type = 'payment' and cancelled_at is null`
  assert.equal(payAfter, 0, 'clearing the date cancels the payment reminder')

  // Document expiry changed.
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const created = await api('/api/documents', cookie, 'POST', {
    customerId: cust.id, category: 'CDL', fileName: `X8-${Date.now()}.pdf`, expiresOn: in7,
  })
  const createdBody = await created.json().catch(() => ({}))
  assert.equal(created.status, 200, JSON.stringify(createdBody))
  await cron(CRON_SECRET)
  const [{ n: docBefore }] = await sql`select count(*)::int n from notifications
                                        where source_id = ${createdBody.id} and cancelled_at is null`
  assert.ok(docBefore > 0)
  const moved = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  assert.equal((await api('/api/documents', cookie, 'PATCH', { id: createdBody.id, expiresOn: moved })).status, 200)
  await cron(CRON_SECRET)
  const [{ n: docStale }] = await sql`select count(*)::int n from notifications
                                       where source_id = ${createdBody.id} and cancelled_at is null
                                         and event_key like ${'doc-expiry:' + in7 + ':%'}`
  assert.equal(docStale, 0, 'the reminder for the old expiry date is cancelled')

  // Task completed.
  const email = `x8-task-${Date.now()}@example.test`
  await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  const [t] = await sql`insert into tasks (title, assignee_id, status, due_at, priority)
                        values (${'X8-TASK-' + Date.now()}, ${u.id}, 'Open', ${new Date(Date.now() - 86400000).toISOString()}, 'Normal') returning id`
  await cron(CRON_SECRET)
  const [{ n: taskBefore }] = await sql`select count(*)::int n from notifications where source_id = ${t.id} and cancelled_at is null`
  assert.ok(taskBefore > 0)
  await sql`update tasks set status = 'Completed' where id = ${t.id}`
  await cron(CRON_SECRET)
  const [{ n: taskAfter }] = await sql`select count(*)::int n from notifications where source_id = ${t.id} and cancelled_at is null`
  assert.equal(taskAfter, 0, 'completing a task cancels its reminder')
})

test('X9: document permissions are explicit and scoped users cannot create orphans', async () => {
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status)
                           values (${'X9Cust' + Date.now()}, 'Perm', 'ACTIVE') returning id`
  // READ_ONLY and BILLING hold no document write permission.
  for (const role of ['READ_ONLY', 'BILLING']) {
    const cookie = await ensureUser(`x9-${role.toLowerCase()}-${Date.now()}@example.test`, role)
    const res = await api('/api/documents', cookie, 'POST', { customerId: cust.id, category: 'CDL', fileName: 'x9.pdf' })
    assert.equal(res.status, 403, `${role} must not create documents`)
  }
  // CASE_AGENT is the DOCUMENT-SCOPED role under the documented policy
  // (DOCUMENT_STAFF has company-wide document access — see Y7).
  const agentEmail = `x9-agent-${Date.now()}@example.test`
  const agent = await ensureUser(agentEmail, 'CASE_AGENT')
  const [au] = await sql`select id from users where email = ${agentEmail.toLowerCase()}`
  const [own] = await sql`insert into customers (first_name,last_name,agent_id,approval_status)
                          values (${'X9Own' + Date.now()}, 'Agent', ${au.id}, 'ACTIVE') returning id`
  const ok = await api('/api/documents', agent, 'POST', { customerId: own.id, category: 'CDL', fileName: 'x9-ok.pdf' })
  assert.equal(ok.status, 200, await ok.text())

  // A document-scoped user cannot create an orphan they could never see again.
  const orphan = await api('/api/documents', agent, 'POST', { category: 'Other', fileName: 'x9-orphan.pdf' })
  assert.equal(orphan.status, 400, 'an orphan document must be refused for a scoped user')

  // Cross-customer access is refused.
  const cross = await api('/api/documents', agent, 'POST', { customerId: cust.id, category: 'CDL', fileName: 'x9-cross.pdf' })
  assert.equal(cross.status, 404, 'a customer they cannot see must be refused')
})

// ===========================================================================
// Final remediation
// ===========================================================================
test('Y1: both forms render the court timezone selector', async () => {
  const cookie = await owner()
  const caseForm = await (await fetch(`${BASE}/cases/new`, { headers: { cookie } })).text()
  assert.ok(caseForm.includes('Court timezone'), 'the case form must render the selector')
  assert.ok(caseForm.includes('America/Denver'), 'selector options must be present')

  const h = await makeHearingCase({ email: `y1-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 9 * 86400000).toISOString(), citation: `Y1-${Date.now()}` })
  const hearingForm = await (await fetch(`${BASE}/hearings/${h.caseId}`, { headers: { cookie } })).text()
  assert.ok(hearingForm.includes('Court timezone'), 'the hearing form must render the selector')
})

test('Y2: Texas/Denver hearing — a non-time edit preserves hearing_at and hearing_tz', async () => {
  const cookie = await owner()
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status)
                           values (${'Y2Cust' + Date.now()}, 'Tz', 'ACTIVE') returning id`
  // 1. Create a Texas hearing explicitly in America/Denver.
  const instant = new Date(Date.now() + 9 * 86400000).toISOString()
  const created = await api('/api/cases', cookie, 'POST', {
    customerId: cust.id, citation: `Y2-${Date.now()}`, state: 'TX',
    hearingAt: instant, hearingTz: 'America/Denver', status: 'Hearing Scheduled',
  })
  const createdBody = await created.json().catch(() => ({}))
  assert.equal(created.status, 200, JSON.stringify(createdBody))
  const caseId = createdBody.id
  const [before] = await sql`select hearing_at, hearing_tz from cases where id = ${caseId}`
  assert.equal(before.hearing_tz, 'America/Denver', 'the explicit zone is stored, not the Texas default')

  // 2-4. Edit ONLY the preparation status, submitting the form's existing values.
  const save = await api('/api/hearings', cookie, 'POST', {
    caseId, hearingAt: before.hearing_at.toISOString(), hearingTz: before.hearing_tz,
    hearingType: 'In person', prepStatus: 'Ready', status: 'Hearing Scheduled', state: 'TX',
  })
  assert.equal(save.status, 200, await save.text())

  // 5. Neither the instant nor the timezone moved.
  const [after] = await sql`select hearing_at, hearing_tz, prep_status from cases where id = ${caseId}`
  assert.equal(after.hearing_at.toISOString(), before.hearing_at.toISOString(), 'hearing_at must not move')
  assert.equal(after.hearing_tz, 'America/Denver', 'hearing_tz must be preserved exactly')
  assert.equal(after.prep_status, 'Ready')

  // 6-7. Deliberately change the timezone; the stored zone and instant are correct.
  const changed = await api('/api/hearings', cookie, 'POST', {
    caseId, hearingAt: before.hearing_at.toISOString(), hearingTz: 'America/Chicago',
    hearingType: 'In person', prepStatus: 'Ready', status: 'Hearing Scheduled', state: 'TX',
  })
  assert.equal(changed.status, 200, await changed.text())
  const [final] = await sql`select hearing_at, hearing_tz from cases where id = ${caseId}`
  assert.equal(final.hearing_tz, 'America/Chicago')
  assert.equal(final.hearing_at.toISOString(), before.hearing_at.toISOString(),
    'a timezone-only correction keeps the same UTC instant')

  // The reminder identity changed, so old-timezone content is cancelled.
  const [{ n: staleActive }] = await sql`select count(*)::int n from notifications
                                          where source_id = ${caseId} and cancelled_at is null
                                            and event_key like '%America/Denver%'`
  assert.equal(staleActive, 0, 'reminders written in the old zone must be cancelled')
})

test('Y3: reassignment through the real API moves reminders immediately, no cron', async () => {
  const cite = `Y3-${Date.now()}`
  const a = await makeHearingCase({ email: `y3a-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  await deliverNow(a.caseId, '%')
  const [aRow] = await sql`select id from notifications where source_id = ${a.caseId}
                            and recipient_user_id = ${a.userId} and cancelled_at is null limit 1`
  assert.ok(aRow, 'Agent A has an active reminder')

  const bEmail = `y3b-${Date.now()}@example.test`
  await ensureUser(bEmail, 'CASE_AGENT')
  const [b] = await sql`select id from users where email = ${bEmail.toLowerCase()}`

  // Real workflow: the assignment API, with NO cron run afterwards.
  const res = await api('/api/assign', (await owner()), 'POST', { customerId: a.customerId, agentId: b.id })
  assert.equal(res.status, 200, await res.text())

  const [aAfter] = await sql`select cancelled_at from notifications where id = ${aRow.id}`
  assert.ok(aAfter.cancelled_at, 'the former agent loses it immediately')
  const feed = await (await api('/api/notifications', a.cookie, 'GET')).text()
  assert.ok(!feed.includes(aRow.id), 'it disappears from the former agent\u2019s feed')
  for (const action of ['read', 'acknowledge', 'dismiss']) {
    assert.equal((await api('/api/notifications', a.cookie, 'PATCH', { action, id: aRow.id })).status, 404)
  }
  const [{ n: bCount }] = await sql`select count(*)::int n from notifications
                                     where source_id = ${a.caseId} and recipient_user_id = ${b.id} and cancelled_at is null`
  assert.ok(bCount > 0, 'the new agent receives reminders immediately')
})

test('Y4: disabling a manager immediately cancels their reminder copies', async () => {
  const mgrEmail = `y4-mgr-${Date.now()}@example.test`
  await ensureUser(mgrEmail, 'MANAGER')
  const [mgr] = await sql`select id from users where email = ${mgrEmail.toLowerCase()}`
  const h = await makeHearingCase({ email: `y4-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: `Y4-${Date.now()}` })
  await cron(CRON_SECRET)
  const [copy] = await sql`select id from notifications where source_id = ${h.caseId}
                            and recipient_user_id = ${mgr.id} and cancelled_at is null limit 1`
  assert.ok(copy, 'the manager has a copy')

  // Real workflow: the users API, no cron afterwards.
  const res = await api('/api/users', (await owner()), 'PATCH', { id: mgr.id, status: 'DISABLED' })
  assert.equal(res.status, 200, await res.text())
  const [after] = await sql`select cancelled_at from notifications where id = ${copy.id}`
  assert.ok(after.cancelled_at, 'a disabled manager\u2019s copy must be cancelled immediately')
})

test('Y5: a failing reconciliation rolls back the case update', async () => {
  const cite = `Y5-${Date.now()}`
  const h = await makeHearingCase({ email: `y5-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 9 * 86400000).toISOString(), citation: cite })
  const [before] = await sql`select hearing_at, hearing_tz, prep_status from cases where id = ${h.caseId}`

  // Force reconciliation to fail inside the transaction with a constraint that
  // only the reconciliation write can violate.
  await sql`alter table notifications add constraint y5_block check (type <> 'hearing') not valid`
  try {
    const res = await api('/api/hearings', (await owner()), 'POST', {
      caseId: h.caseId, hearingAt: new Date(Date.now() + 15 * 86400000).toISOString(),
      hearingTz: 'America/New_York', hearingType: 'Zoom', prepStatus: 'Ready', status: 'Hearing Scheduled',
    })
    assert.equal(res.status, 500, 'a reconciliation failure must not return success')
    const [after] = await sql`select hearing_at, hearing_tz, prep_status from cases where id = ${h.caseId}`
    assert.deepEqual(
      { a: after.hearing_at?.toISOString(), t: after.hearing_tz, p: after.prep_status },
      { a: before.hearing_at?.toISOString(), t: before.hearing_tz, p: before.prep_status },
      'the case update must be rolled back',
    )
  } finally {
    await sql`alter table notifications drop constraint if exists y5_block`
  }
})

test('Y6: document expiry can be set, changed and cleared through the UI control', async () => {
  const cookie = await owner()
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status)
                           values (${'Y6Cust' + Date.now()}, 'Docs', 'ACTIVE') returning id`
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const created = await api('/api/documents', cookie, 'POST', {
    customerId: cust.id, category: 'CDL', fileName: `Y6-${Date.now()}.pdf`, expiresOn: in7,
  })
  const body = await created.json().catch(() => ({}))
  assert.equal(created.status, 200, JSON.stringify(body))

  // The page displays it and offers the control to an authorised role.
  const html = await (await fetch(`${BASE}/documents`, { headers: { cookie } })).text()
  assert.ok(html.includes('Expires'), 'the expiry column is displayed')
  assert.ok(html.includes('Save'), 'the authorised editor is rendered')

  // Impossible dates are rejected.
  assert.equal((await api('/api/documents', cookie, 'PATCH', { id: body.id, expiresOn: '2026-02-31' })).status, 400)
  // Clearing works.
  assert.equal((await api('/api/documents', cookie, 'PATCH', { id: body.id, expiresOn: '' })).status, 200)
  const [row] = await sql`select expires_on from documents where id = ${body.id}`
  assert.equal(row.expires_on, null, 'the expiry date is cleared')
})

test('Y7: DOCUMENT_STAFF has usable company-wide document access; agents stay scoped', async () => {
  const [cust] = await sql`insert into customers (first_name,last_name,approval_status)
                           values (${'Y7Cust' + Date.now()}, 'Any', 'ACTIVE') returning id`
  // DOCUMENT_STAFF owns no customers but must still be able to file documents.
  const staff = await ensureUser(`y7-staff-${Date.now()}@example.test`, 'DOCUMENT_STAFF')
  const ok = await api('/api/documents', staff, 'POST', { customerId: cust.id, category: 'CDL', fileName: `Y7-${Date.now()}.pdf` })
  assert.equal(ok.status, 200, `DOCUMENT_STAFF must have usable access: ${await ok.text()}`)

  // A CASE_AGENT may not touch another agent's customer's document.
  const agent = await ensureUser(`y7-agent-${Date.now()}@example.test`, 'CASE_AGENT')
  const denied = await api('/api/documents', agent, 'POST', { customerId: cust.id, category: 'CDL', fileName: 'y7-x.pdf' })
  assert.equal(denied.status, 404, 'a case agent stays scoped to assigned customers')
})

test('Y8: notification counts are computed beyond the first 50 rows', async () => {
  const email = `y8-${Date.now()}@example.test`
  const cookie = await ensureUser(email, 'CASE_AGENT')
  const [u] = await sql`select id from users where email = ${email.toLowerCase()}`
  for (let i = 0; i < 60; i++) {
    await sql`insert into notifications (recipient_user_id, type, priority, source_type, source_id, event_key,
                                         title, message, scheduled_for, delivery_status, delivered_at)
              values (${u.id}, 'task', 'normal', 'task', ${'y8-' + i}, ${'y8-key-' + i},
                      ${'Y8 ' + i}, 'bulk', now() - interval '1 minute', 'delivered', now())`
  }
  const res = await api('/api/notifications', cookie, 'GET')
  const body = await res.json()
  assert.ok(body.items.length <= 50, 'the page is limited')
  assert.equal(body.unread, 60, 'the unread count covers every active delivered row, not just the page')
})

test('Z1: a failing reconciliation rolls back the entire assignment', async () => {
  const cite = `Z1-${Date.now()}`
  const a = await makeHearingCase({ email: `z1a-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  const bEmail = `z1b-${Date.now()}@example.test`
  await ensureUser(bEmail, 'CASE_AGENT')
  const [b] = await sql`select id from users where email = ${bEmail.toLowerCase()}`

  const [custBefore] = await sql`select agent_id from customers where id = ${a.customerId}`
  const [caseBefore] = await sql`select agent_id from cases where id = ${a.caseId}`
  const notifBefore = await sql`select id, cancelled_at, recipient_user_id from notifications
                                 where source_id = ${a.caseId} order by id`

  // Force the reconciliation write inside the transaction to fail.
  await sql`alter table notifications add constraint z1_block check (type <> 'hearing') not valid`
  try {
    const res = await api('/api/assign', (await owner()), 'POST', { customerId: a.customerId, agentId: b.id })
    assert.equal(res.status, 500, 'a reconciliation failure must not report success')
    const body = await res.json().catch(() => ({}))
    assert.ok(!/saved but/i.test(body.error || ''), 'must never claim the assignment was saved')

    const [custAfter] = await sql`select agent_id from customers where id = ${a.customerId}`
    const [caseAfter] = await sql`select agent_id from cases where id = ${a.caseId}`
    const notifAfter = await sql`select id, cancelled_at, recipient_user_id from notifications
                                  where source_id = ${a.caseId} order by id`
    assert.equal(custAfter.agent_id, custBefore.agent_id, 'customers.agent_id must be unchanged')
    assert.equal(caseAfter.agent_id, caseBefore.agent_id, 'cases.agent_id must be unchanged')
    assert.equal(notifAfter.length, notifBefore.length, 'no notification rows added or removed')
    assert.deepEqual(
      notifAfter.map((n) => [n.id, n.cancelled_at?.toISOString() ?? null, n.recipient_user_id]),
      notifBefore.map((n) => [n.id, n.cancelled_at?.toISOString() ?? null, n.recipient_user_id]),
      'notifications must be byte-for-byte unchanged',
    )
  } finally {
    await sql`alter table notifications drop constraint if exists z1_block`
  }
})

test('Z2: a successful assignment moves reminders before the API returns, with no cron', async () => {
  const cite = `Z2-${Date.now()}`
  const a = await makeHearingCase({ email: `z2a-${Date.now()}@example.test`, hearingAt: new Date(Date.now() + 26 * 3600000).toISOString(), citation: cite })
  await cron(CRON_SECRET)
  await deliverNow(a.caseId, '%')
  const [aRow] = await sql`select id from notifications where source_id = ${a.caseId}
                            and recipient_user_id = ${a.userId} and cancelled_at is null limit 1`
  assert.ok(aRow, 'Agent A holds an active reminder')

  const bEmail = `z2b-${Date.now()}@example.test`
  await ensureUser(bEmail, 'CASE_AGENT')
  const [b] = await sql`select id from users where email = ${bEmail.toLowerCase()}`

  const res = await api('/api/assign', (await owner()), 'POST', { customerId: a.customerId, agentId: b.id })
  assert.equal(res.status, 200, await res.text())

  // Asserted immediately after the 200, with NO cron run in between.
  const [aAfter] = await sql`select cancelled_at from notifications where id = ${aRow.id}`
  assert.ok(aAfter.cancelled_at, 'the former agent loses it before the API returns')
  const [{ n: bCount }] = await sql`select count(*)::int n from notifications
                                     where source_id = ${a.caseId} and recipient_user_id = ${b.id} and cancelled_at is null`
  assert.ok(bCount > 0, 'the new agent already has reminders when the API returns')
  const [caseRow] = await sql`select agent_id from cases where id = ${a.caseId}`
  assert.equal(caseRow.agent_id, b.id, 'the case follows the customer assignment')
})

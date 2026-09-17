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
    courtPhone: '(253) 555-0142', status: 'Hearing Scheduled',
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

  const admin = await api('/api/notifications', (await owner()), 'GET')
  const adminBody = await admin.text()
  assert.ok(adminBody.includes('888') || adminBody.includes('777'), 'an admin must still receive figures')
})

test('C: a non-financial role sees no amounts on the notifications page or customer detail', async () => {
  const agent = await ensureUser('objC2@example.test', 'CASE_AGENT')
  const [u] = await sql`select id from users where email = 'objc2@example.test'`
  const [cust] = await sql`insert into customers (first_name,last_name,agent_id,approval_status) values ('FeeHidden','Cust',${u.id},'ACTIVE') returning id`
  await sql`insert into cases (customer_id, citation, fee, agent_id, approval_status) values (${cust.id},'FEE-1',1234,${u.id},'ACTIVE')`

  const notif = await (await fetch(`${BASE}/notifications`, { headers: { cookie: agent } })).text()
  assert.ok(notif.includes('Not available'), 'financial alerts must be refused')
  assert.ok(!notif.includes('1234'))

  const detail = await (await fetch(`${BASE}/customers/${cust.id}`, { headers: { cookie: agent } })).text()
  assert.ok(!detail.includes('1234'), 'the fee must not appear in the All cases table')
  assert.ok(!/>\s*Remaining\s*</.test(detail), 'the Remaining column must be hidden')
})

test('D: protected pages are denied by direct URL for unauthorised roles', async () => {
  const agent = await ensureUser('objD1@example.test', 'CASE_AGENT')
  for (const path of ['/agents', '/users', '/users/new', '/audit', '/settings', '/reports', '/notifications']) {
    const html = await (await fetch(`${BASE}${path}`, { headers: { cookie: agent } })).text()
    assert.ok(html.includes('Not available'), `${path} must be refused for a CASE_AGENT`)
  }
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

  const notif = await api('/api/notifications', billing, 'GET')
  const body = await notif.text()
  assert.ok(body.includes('4242') || body.includes('4,242'), 'BILLING notifications must be organisation-wide')

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

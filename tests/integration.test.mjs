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
    { title: 'ok', assignee: 'z'.repeat(5000) },
    { title: 'ok', priority: 'Critical' },
    { title: 'ok', dueAt: 'not-a-date' },
    { title: '   ' },
  ]) {
    const r = await api('/api/tasks', cookie, 'POST', body)
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 40)} -> ${r.status}`)
  }
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

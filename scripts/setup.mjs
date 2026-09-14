#!/usr/bin/env node
// Explicit database provisioning script. This is intentionally NOT an HTTP endpoint —
// run it yourself (locally, in CI, or as a one-off command against your deploy target)
// with production credentials in your environment, e.g.:
//
//   DATABASE_URL=postgres://... \
//   SUPERADMIN_EMAIL=owner@yourdomain.com \
//   SUPERADMIN_PASSWORD='a-strong-unique-password' \
//   npm run db:setup
//
// It creates/upgrades the schema (safe to re-run any time — every statement is
// idempotent) and creates the initial Super Admin account IF one doesn't already exist
// for that email. It never prints the password back out, and it refuses to run at all
// if SUPERADMIN_PASSWORD is missing or weak, rather than falling back to a guessable
// default. Existing databases / existing accounts are left untouched.
import postgres from 'postgres'
import bcrypt from 'bcryptjs'

function fail(msg) {
  console.error('\n✖ ' + msg + '\n')
  process.exit(1)
}

const rawUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING
if (!rawUrl) fail('No database URL found. Set DATABASE_URL (or POSTGRES_URL) in the environment running this script.')
const url = rawUrl.replace(/([?&])channel_binding=require&?/i, '$1').replace(/[?&]$/, '')

const email = (process.env.SUPERADMIN_EMAIL || '').toLowerCase().trim()
const password = process.env.SUPERADMIN_PASSWORD || ''
const name = process.env.SUPERADMIN_NAME || 'System Owner'

if (!email || !email.includes('@')) fail('SUPERADMIN_EMAIL is required and must be a valid email address.')
if (!password || password.length < 12) fail('SUPERADMIN_PASSWORD is required and must be at least 12 characters. Use a randomly generated password — this is a Super Admin account.')
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 16) {
  console.warn('⚠ AUTH_SECRET is not set (or is short) in this environment. The app will refuse to start in production without it. ' +
    'Generate one with `openssl rand -base64 32` and set it in your deployment environment before going live.')
}

// Kept in sync with lib/schema.ts's CREATE/ALTER/INDEXES. Duplicated here (rather than
// imported) because this script runs directly under plain Node, outside the Next.js/TS
// build pipeline.
const CREATE = `
create table if not exists users (
  id text primary key default gen_random_uuid(),
  name text not null, email text unique not null, password_hash text not null,
  role text not null default 'CASE_AGENT', status text not null default 'ACTIVE',
  last_login_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists customers (
  id text primary key default gen_random_uuid(),
  first_name text not null, last_name text not null,
  created_at timestamptz not null default now()
);
create table if not exists cases (
  id text primary key default gen_random_uuid(),
  customer_id text not null references customers(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists payments (
  id text primary key default gen_random_uuid(),
  customer_id text not null references customers(id) on delete cascade,
  amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists tasks (
  id text primary key default gen_random_uuid(),
  title text not null, created_at timestamptz not null default now()
);
create table if not exists login_attempts (
  email text primary key, attempts int not null default 0,
  locked_until timestamptz, updated_at timestamptz not null default now()
);
create table if not exists settings (key text primary key, value text, updated_at timestamptz not null default now());
create table if not exists documents (
  id text primary key default gen_random_uuid(),
  category text not null default 'File', file_name text not null default '', url text not null default '',
  created_at timestamptz not null default now()
);
`
const ALTER = `
alter table customers add column if not exists legacy_member_id text;
alter table customers add column if not exists dob date;
alter table customers add column if not exists email text;
alter table customers add column if not exists phone text;
alter table customers add column if not exists state text;
alter table customers add column if not exists plan text;
alter table customers add column if not exists sub_status text default 'Active';
alter table customers add column if not exists pay_channel text;
alter table customers add column if not exists next_payment text;
alter table customers add column if not exists cdl text default 'No';
alter table customers add column if not exists license_no text;
alter table customers add column if not exists dot text default 'No';
alter table customers add column if not exists agent_id text;
alter table customers add column if not exists joined_at timestamptz default now();
alter table cases add column if not exists citation text;
alter table cases add column if not exists official_no text;
alter table cases add column if not exists court text;
alter table cases add column if not exists state text;
alter table cases add column if not exists status text default 'New';
alter table cases add column if not exists priority text default 'Normal';
alter table cases add column if not exists cmv text default 'Unknown';
alter table cases add column if not exists cdl text default 'Unknown';
alter table cases add column if not exists fine numeric(10,2);
alter table cases add column if not exists fee numeric(10,2);
alter table cases add column if not exists fee_since timestamptz;
alter table cases add column if not exists next_action text;
alter table cases add column if not exists next_action_at timestamptz;
alter table cases add column if not exists agent_id text;
alter table cases add column if not exists hearing_at timestamptz;
alter table cases add column if not exists hearing_tz text;
alter table cases add column if not exists hearing_type text default 'In person';
alter table cases add column if not exists prep_status text default 'Not started';
alter table payments add column if not exists case_id text;
alter table payments add column if not exists kind text default 'Membership';
alter table payments add column if not exists method text default 'Card';
alter table payments add column if not exists status text default 'Paid';
alter table payments add column if not exists invoice text;
alter table payments add column if not exists paid_at timestamptz default now();
alter table tasks add column if not exists case_ref text;
alter table tasks add column if not exists customer_id text;
alter table tasks add column if not exists assignee text;
alter table tasks add column if not exists due_at timestamptz;
alter table tasks add column if not exists priority text default 'Normal';
alter table tasks add column if not exists status text default 'Open';
alter table documents add column if not exists customer_id text;
alter table documents add column if not exists case_id text;
alter table users add column if not exists token_version int not null default 0;
`
const INDEXES = `
create index if not exists idx_cases_customer_id on cases(customer_id);
create index if not exists idx_cases_status on cases(status);
create index if not exists idx_cases_hearing_at on cases(hearing_at);
create index if not exists idx_cases_next_action_at on cases(next_action_at);
create index if not exists idx_cases_created_at on cases(created_at);
create index if not exists idx_payments_customer_id on payments(customer_id);
create index if not exists idx_payments_case_id on payments(case_id);
create index if not exists idx_payments_paid_at on payments(paid_at);
create index if not exists idx_tasks_customer_id on tasks(customer_id);
create index if not exists idx_tasks_due_at on tasks(due_at);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_documents_customer_id on documents(customer_id);
create index if not exists idx_documents_case_id on documents(case_id);
create index if not exists idx_customers_created_at on customers(created_at);
create index if not exists idx_customers_agent_id on customers(agent_id);
`

const sql = postgres(url, { ssl: 'require', prepare: false, max: 1, connect_timeout: 30, onnotice: () => {} })

try {
  console.log('→ Ensuring schema (tables, columns, indexes)...')
  await sql.unsafe(CREATE)
  await sql.unsafe(ALTER)
  await sql.unsafe(INDEXES)
  await sql`insert into settings (key, value) values ('schema_version', 'v4-token-version')
    on conflict (key) do update set value = excluded.value, updated_at = now()`
  console.log('✓ Schema is up to date.')

  const existing = await sql`select id, role from users where email = ${email} limit 1`
  if (existing.length > 0) {
    console.log(`✓ A user with email ${email} already exists (role: ${existing[0].role}). Not creating a duplicate or changing it.`)
    console.log('  If you need to reset that account, do it through the app as another Super Admin, not this script.')
  } else {
    const hash = await bcrypt.hash(password, 12)
    await sql`insert into users (name, email, password_hash, role, status) values (${name}, ${email}, ${hash}, 'SUPER_ADMIN', 'ACTIVE')`
    console.log(`✓ Created Super Admin: ${name} <${email}>`)
    console.log('  Log in with the password you set in SUPERADMIN_PASSWORD, then change it from Profile immediately.')
  }
} catch (e) {
  console.error('\n✖ Setup failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}

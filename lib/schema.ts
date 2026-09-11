import { getSql } from './db'
import bcrypt from 'bcryptjs'

let ensured = false

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

// Add every non-core column defensively so databases created by older versions get upgraded.
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
`

export async function ensureSchema(): Promise<void> {
  const sql = getSql()
  await sql.unsafe(CREATE)
  await sql.unsafe(ALTER)
  const email = (process.env.SUPERADMIN_EMAIL || 'owner@clprotectionusa.com').toLowerCase()
  const existing = await sql`select id from users where email = ${email} limit 1`
  if (existing.length === 0) {
    const name = process.env.SUPERADMIN_NAME || 'System Owner'
    const pw = process.env.SUPERADMIN_PASSWORD || 'KpZXiHVGCYuTanAa1!'
    const hash = await bcrypt.hash(pw, 12)
    await sql`insert into users (name, email, password_hash, role, status)
      values (${name}, ${email}, ${hash}, 'SUPER_ADMIN', 'ACTIVE') on conflict (email) do nothing`
  }
  ensured = true
}

export async function ensureSchemaOnce(): Promise<void> {
  if (ensured) return
  try { await ensureSchema() } catch (e) { console.error('ensureSchema failed:', e) }
}

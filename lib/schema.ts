import { getSql } from './db'
import bcrypt from 'bcryptjs'

let ensured = false

const DDL = `
create table if not exists users (
  id text primary key default gen_random_uuid(),
  name text not null, email text unique not null, password_hash text not null,
  role text not null default 'CASE_AGENT', status text not null default 'ACTIVE',
  last_login_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists customers (
  id text primary key default gen_random_uuid(),
  first_name text not null, last_name text not null, email text, phone text, state text,
  plan text, sub_status text not null default 'Active', pay_channel text, next_payment text,
  cdl text not null default 'No', license_no text, dot text not null default 'No',
  agent_id text references users(id) on delete set null,
  joined_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table if not exists cases (
  id text primary key default gen_random_uuid(),
  customer_id text not null references customers(id) on delete cascade,
  citation text, official_no text, court text, state text,
  status text not null default 'New', priority text not null default 'Normal',
  cmv text default 'Unknown', cdl text default 'Unknown',
  fine numeric(10,2), fee numeric(10,2), fee_since timestamptz,
  next_action text, next_action_at timestamptz, agent_id text references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists payments (
  id text primary key default gen_random_uuid(),
  customer_id text not null references customers(id) on delete cascade,
  case_id text references cases(id) on delete set null,
  kind text not null, method text not null, amount numeric(10,2) not null,
  status text not null default 'Paid', invoice text, paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists tasks (
  id text primary key default gen_random_uuid(),
  title text not null, case_ref text, customer_id text, assignee text,
  due_at timestamptz, priority text default 'Normal', status text not null default 'Open',
  created_at timestamptz not null default now()
);
create table if not exists login_attempts (
  email text primary key, attempts int not null default 0,
  locked_until timestamptz, updated_at timestamptz not null default now()
);
create table if not exists settings (
  key text primary key, value text, updated_at timestamptz not null default now()
);
create table if not exists documents (
  id text primary key default gen_random_uuid(),
  customer_id text, case_id text, category text not null, file_name text not null, url text not null,
  created_at timestamptz not null default now()
);
`

/** Creates all tables (idempotent) and seeds the Super Admin if missing. */
export async function ensureSchema(): Promise<void> {
  const sql = getSql()
  await sql.unsafe(DDL)
  const email = (process.env.SUPERADMIN_EMAIL || 'owner@clprotectionusa.com').toLowerCase()
  const existing = await sql`select id from users where email = ${email} limit 1`
  if (existing.length === 0) {
    const name = process.env.SUPERADMIN_NAME || 'System Owner'
    const pw = process.env.SUPERADMIN_PASSWORD || 'KpZXiHVGCYuTanAa1!'
    const hash = await bcrypt.hash(pw, 12)
    await sql`insert into users (name, email, password_hash, role, status)
      values (${name}, ${email}, ${hash}, 'SUPER_ADMIN', 'ACTIVE')
      on conflict (email) do nothing`
  }
  ensured = true
}

/** Runs ensureSchema once per warm instance; never throws. */
export async function ensureSchemaOnce(): Promise<void> {
  if (ensured) return
  try { await ensureSchema() } catch (e) { console.error('ensureSchema failed:', e) }
}

import fs from 'node:fs'
import postgres from 'postgres'
import bcrypt from 'bcryptjs'

// load .env (simple parser) if present
try {
  const env = fs.readFileSync('.env', 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DATABASE_URL (or DIRECT_URL) in .env'); process.exit(1) }
const sql = postgres(url, { ssl: 'require' })

const ddl = `
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
  email text primary key,
  attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists documents (
  id text primary key default gen_random_uuid(),
  customer_id text, case_id text, category text not null, file_name text not null, url text not null,
  created_at timestamptz not null default now()
);
`

async function main() {
  await sql.unsafe(ddl)
  console.log('✓ Tables ready')

  const email = (process.env.SUPERADMIN_EMAIL || 'owner@clprotectionusa.com').toLowerCase()
  const name = process.env.SUPERADMIN_NAME || 'System Owner'
  const password = process.env.SUPERADMIN_PASSWORD || 'ChangeMe!Now-2026'
  const existing = await sql`select id from users where email = ${email} limit 1`
  if (existing.length) { console.log('✓ Super admin already exists:', email) }
  else {
    const hash = await bcrypt.hash(password, 12)
    await sql`insert into users (name, email, password_hash, role, status) values (${name}, ${email}, ${hash}, 'SUPER_ADMIN', 'ACTIVE')`
    console.log('✓ Created super admin:', email, '(change the password after first login)')
  }
  await sql.end()
  console.log('Done.')
}
main().catch((e) => { console.error(e); process.exit(1) })

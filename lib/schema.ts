
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
alter table users add column if not exists session_version integer not null default 0;
alter table tasks add column if not exists assignee_id text;
alter table customers add column if not exists approval_status text not null default 'ACTIVE';
alter table customers add column if not exists created_by text;
alter table customers add column if not exists approved_by text;
alter table customers add column if not exists approved_at timestamptz;
alter table customers add column if not exists rejection_reason text;
alter table cases add column if not exists approval_status text not null default 'ACTIVE';
alter table cases add column if not exists created_by text;
alter table cases add column if not exists approved_by text;
alter table cases add column if not exists approved_at timestamptz;
alter table cases add column if not exists rejection_reason text;
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
alter table cases add column if not exists court_phone text;
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

-- Backfill the stable id from the historical free-text assignee name, but ONLY
-- when that name matches exactly one account. User names are not unique, so a
-- naive join could hand a confidential task to the wrong person. Ambiguous and
-- unmatched rows keep assignee_id NULL and stay visible only to full-visibility
-- management until an administrator assigns them deliberately.
update tasks t
   set assignee_id = (select u.id from users u where u.name = t.assignee)
 where t.assignee_id is null
   and t.assignee is not null
   and (select count(*) from users u where u.name = t.assignee) = 1;

-- Intentional deletion policy: removing a user un-assigns their tasks rather
-- than deleting the work or leaving a dangling id.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where constraint_name = 'tasks_assignee_id_fkey' and table_name = 'tasks'
  ) then
    -- Clear any id that no longer resolves, so the constraint can be added.
    update tasks set assignee_id = null
     where assignee_id is not null
       and not exists (select 1 from users u where u.id = tasks.assignee_id);
    alter table tasks
      add constraint tasks_assignee_id_fkey
      foreign key (assignee_id) references users (id) on delete set null;
  end if;
end $$;
`

// Speeds up every list/dashboard/report page, which all filter or sort by these columns.
const INDEXES = `
create index if not exists tasks_assignee_id_idx on tasks (assignee_id);
create index if not exists customers_approval_idx on customers (approval_status);
create index if not exists cases_approval_idx on cases (approval_status);

create index if not exists login_attempts_updated_at_idx on login_attempts (updated_at);
create index if not exists idx_cases_customer_id on cases(customer_id);
create index if not exists idx_cases_status on cases(status);
create index if not exists idx_cases_hearing_at on cases(hearing_at);
create index if not exists idx_cases_next_action_at on cases(next_action_at);
create index if not exists idx_cases_created_at on cases(created_at);
create index if not exists idx_payments_customer_id on payments(customer_id);
create index if not exists idx_payments_paid_at on payments(paid_at);
create index if not exists idx_tasks_customer_id on tasks(customer_id);
create index if not exists idx_tasks_due_at on tasks(due_at);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_documents_customer_id on documents(customer_id);
create index if not exists idx_documents_case_id on documents(case_id);
create index if not exists idx_customers_created_at on customers(created_at);
create index if not exists idx_customers_agent_id on customers(agent_id);
`

/**
 * NOTE: this module intentionally exports NO runtime helpers.
 *
 * Schema creation and migration are CLI/CI-only operations performed by
 * scripts/setup.mjs, which reads the CREATE / ALTER / INDEXES blocks above
 * directly from this file. Deliberately keeping no exported
 * ensureSchema()/ensureSchemaOnce()/seedSuperAdmin() function means DDL
 * cannot be re-introduced into request handling by a stray import.
 */
export {}

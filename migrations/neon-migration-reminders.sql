-- =====================================================================
-- CL Protection Portal — Feature 2: automated reminders
-- Run in the Neon SQL Editor BEFORE deploying the application code.
-- Idempotent, additive, safe to rerun, safe for existing production data.
-- Does not alter or remove neon-migration-sessions.sql.
-- =====================================================================

-- ---------- persistent notifications ----------
create table if not exists notifications (
  id                  text primary key default gen_random_uuid()::text,
  recipient_user_id   text not null references users (id) on delete cascade,
  type                text not null,
  priority            text not null default 'normal',
  source_type         text not null,
  source_id           text,
  event_key           text not null,
  title               text not null,
  message             text not null,
  action_url          text,
  event_at            timestamptz,
  scheduled_for       timestamptz not null,
  created_at          timestamptz not null default now(),
  read_at             timestamptz,
  dismissed_at        timestamptz,
  acknowledged_at     timestamptz,
  acknowledged_by     text references users (id) on delete set null,
  cancelled_at        timestamptz,
  escalated_at        timestamptz,
  delivery_status     text not null default 'pending',
  delivered_at        timestamptz,
  delivery_attempts   integer not null default 0,
  last_delivery_error text,
  constraint notifications_unique_event
    unique (recipient_user_id, source_type, source_id, event_key)
);

create index if not exists notifications_recipient_idx on notifications (recipient_user_id, scheduled_for);
create index if not exists notifications_pending_idx   on notifications (delivery_status, scheduled_for);
create index if not exists notifications_source_idx    on notifications (source_type, source_id);
create index if not exists notifications_unread_idx    on notifications (recipient_user_id, read_at, cancelled_at);

-- ---------- document expiry ----------
alter table documents add column if not exists expires_on date;
alter table notifications add column if not exists delivered_at timestamptz;
create index if not exists documents_expires_idx on documents (expires_on);

-- ---------- safe next_payment migration ----------
-- customers.next_payment is free text. A new DATE column is added and ONLY
-- values that are provably real ISO calendar dates are copied across. The
-- original text is preserved untouched, and no invalid value is ever rewritten.
alter table customers add column if not exists next_payment_date date;
create index if not exists customers_next_payment_date_idx on customers (next_payment_date);

-- Backfill ONLY values that are provably real ISO calendar dates.
-- A per-row exception guard is required: '2026-02-31' matches the regex but
-- raises on cast, which would abort the whole migration. Invalid values keep
-- their original text in customers.next_payment for a human to correct, and no
-- invalid date is ever silently rewritten to a different one.
do $$
declare r record;
begin
  for r in
    select id, next_payment from customers
     where next_payment_date is null
       and next_payment ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  loop
    begin
      update customers set next_payment_date = r.next_payment::date where id = r.id;
    exception when others then
      -- impossible calendar date: leave next_payment_date null, keep the text
      continue;
    end;
  end loop;
end $$;

-- Report how many legacy values could NOT be converted (review these by hand):
--   select count(*) from customers
--    where next_payment is not null and trim(next_payment) <> '' and next_payment_date is null;
--
-- List them with:
--   select id, first_name, last_name, next_payment from customers
--    where next_payment is not null and trim(next_payment) <> '' and next_payment_date is null;

-- ---------- retention ----------
-- The scheduler prunes cancelled/dismissed notifications older than 90 days.
-- Delivered history is preserved for audit.

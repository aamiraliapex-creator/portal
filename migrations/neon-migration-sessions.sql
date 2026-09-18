-- =====================================================================
-- CL Protection Portal — session & device management migration
-- Run this in the Neon SQL Editor BEFORE deploying the new code.
-- Additive and idempotent: safe to re-run, safe for existing records.
-- =====================================================================

create table if not exists user_sessions (
  id            text primary key default gen_random_uuid()::text,
  user_id       text not null references users (id) on delete cascade,
  session_key   text not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  user_agent    text,
  device        text,
  ip_prefix     text
);

create index if not exists user_sessions_user_idx    on user_sessions (user_id);
create index if not exists user_sessions_expires_idx on user_sessions (expires_at);
create index if not exists user_sessions_active_idx  on user_sessions (user_id, revoked_at);

-- Note: session_key holds only an opaque random identifier.
-- No JWT, cookie value, password or other reusable secret is ever stored here.
--
-- Existing users stay signed in only until their current 8-hour token expires;
-- after this deploy, tokens without a session id are rejected, so everyone
-- simply signs in again. session_version remains the account-wide emergency
-- revocation mechanism.

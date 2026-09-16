# Security model

## Configuration (fail-closed)

| Variable | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | yes | >= 32 chars. Sessions cannot be signed or verified without it; `proxy.ts` returns **503** and API calls fail rather than falling back to a default. |
| `DATABASE_URL` | yes | `sslmode=require` for managed Postgres. `sslmode=disable` is honoured for local development only. |
| `DIRECT_URL` | for migrations | Unpooled URL used by `npm run db:setup`. |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | first install only | Password must be >= 12 chars. No default credential exists. |

## Permission matrix

Enforced server-side in `lib/authz.ts` and applied by `requirePermission()` / `guarded()`
in every write route. Roles are re-read from the database on each request.

| Permission | SUPER_ADMIN | ADMIN | MANAGER | CASE_AGENT | SALES_AGENT | BILLING | DOCUMENT_STAFF | READ_ONLY |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| customer.create / update | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — |
| case.create / update | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| payment.create | ✅ | ✅ | ✅ | — | — | ✅ | — | — |
| task.create / update | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| assignment.update | ✅ | ✅ | ✅ | — | — | — | — | — |
| settings.update | ✅ | ✅ | ✅ | — | — | — | — | — |
| user.manage | ✅ | ✅ | — | — | — | — | — | — |
| user.delete | ✅ | — | — | — | — | — | — | — |
| report.export (read) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| schema.migrate | ✅ | — | — | — | — | — | — | — |

**Assumptions** (change in `lib/authz.ts` if your business rules differ):
BILLING owns money movement; SALES_AGENT owns customer intake; CASE_AGENT owns case work;
DOCUMENT_STAFF handles files; READ_ONLY has **no** write permission anywhere.

### Account-management rules
* Only a SUPER_ADMIN may create, disable or delete another SUPER_ADMIN.
* An actor may only manage accounts strictly **less** privileged than themselves (`ROLE_RANK`).
* Role and status values are validated against allowlists.
* Nobody may change their own status or delete their own account through `/api/users`.
* The last **active** SUPER_ADMIN cannot be disabled or deleted (defence in depth).

## Session handling and revocation
* Session = signed JWT (HS256, 8h) in an httpOnly, SameSite=Lax cookie; `Secure` in production.
* `users.session_version` is embedded in the token as `sv`.
* `getCurrentUser()` re-checks the database on **every** request: the account must exist,
  be `ACTIVE`, and the token's `sv` must match. Role is always taken from the database.
* `session_version` is incremented on password change and on disable, which immediately
  invalidates every previously issued token for that account.
* `proxy.ts` is a cheap first gate only (signature/expiry). It is **not** the authorisation boundary.

## Provisioning
Schema creation and migration happen **only** through the CLI:

```
npm run db:setup      # applies CREATE/ALTER/INDEX statements, optionally seeds the first admin
```

There is **no HTTP provisioning endpoint**. `/api/setup` does not exist and must not
be reintroduced: `lib/schema.ts` deliberately exports no runtime helpers, so DDL
cannot be executed from a page, layout, middleware/proxy or API route. Migrations
are run by an operator (or the CI job) against `DIRECT_URL`, never by request traffic.

## Exports
CSV only. Cells beginning with `= + - @` tab or CR are prefixed with `'` to prevent
spreadsheet formula injection; finite numbers are written unquoted so they stay numeric.
No endpoint labels CSV bytes as `.xls`/`.xlsx`.

## Login rate limiting

Application level (implemented):
* **Admission control runs before bcrypt.** Each request reserves an attempt
  slot in `lib/login-limiter.ts` first; only an admitted request has its
  password verified. Checking `locked_until`, then hashing, then counting the
  failure afterwards would let a simultaneous burst pass the "unlocked" read
  and test many passwords before the counter reached the threshold.
* Reservations are **serialized per normalized email** with a transaction-scoped
  advisory lock (`pg_advisory_xact_lock`), so concurrent requests queue and each
  gets a distinct attempt number. The lock is released at commit — bcrypt runs
  outside it.
* At most **5 password verifications** per active window; the 6th and beyond get
  429 **without their password being tested**.
* An **active lock is never extended** by further requests, and those requests
  are not counted, so hammering cannot keep an account locked indefinitely.
* When a lock expires (or the window goes quiet for 15 minutes) the next failure
  starts a **fresh window at attempt 1** rather than immediately re-locking.
* A successful login **deletes** the counter row.
* Rows untouched for 24 hours are pruned on each failed attempt (an active
  lockout is never pruned), so failed logins against unknown addresses cannot
  grow `login_attempts` without bound. Backed by
  `login_attempts_updated_at_idx`.
* Every attempt runs a real bcrypt comparison — against a fixed dummy hash when
  the account is missing or disabled — so unknown and known accounts follow
  approximately the same path.

Platform level (**must be configured separately — not provided by this code**):
the per-email limiter does nothing against a distributed attack spread across
many addresses, and it can be abused to lock out a known user on purpose.
Add an IP/edge limiter in front of `POST /api/auth/login`:
* **Vercel** — enable WAF rate limiting, or Vercel Firewall rules on that path.
* **Cloudflare** — a Rate Limiting rule (for example 10 requests / 10 minutes / IP).
* Self-hosted — `limit_req` in nginx or an equivalent reverse-proxy limiter.

Because the app sits behind a proxy, do not rate limit on a client-supplied
`X-Forwarded-For` value in application code; use the platform's own limiter,
which sees the real connecting address.

## Password policy

* bcrypt considers only the first 72 **bytes**; passwords longer than that are
  **rejected** at account creation and password change rather than truncated,
  so two values sharing a 72-byte prefix can never be interchangeable.
* Length is measured in UTF-8 bytes, not characters.
* Submitted passwords above 1024 bytes are refused outright to bound hashing
  work per request.
* Migrating to Argon2id would remove the 72-byte constraint entirely; it is not
  done here because it adds a native dependency. The limit is enforced
  consistently in the meantime.

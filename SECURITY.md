# Security model

## Configuration (fail-closed)

| Variable | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | yes | >= 32 chars. Sessions cannot be signed or verified without it; `proxy.ts` returns **503** and API calls fail rather than falling back to a default. |
| `DATABASE_URL` | yes | `sslmode=require` for managed Postgres. `sslmode=disable` is honoured for local development only. |
| `DIRECT_URL` | for migrations | Unpooled URL used by `npm run db:setup`. |
| `SETUP_TOKEN` | only while provisioning | >= 32 chars. When unset, `POST /api/setup` returns 404. |
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
Migrations never run from ordinary page or API traffic. Use either:
1. `npm run db:setup` (recommended), or
2. `POST /api/setup` with `x-setup-token: $SETUP_TOKEN`, then unset `SETUP_TOKEN`.

## Exports
CSV only. Cells beginning with `= + - @` tab or CR are prefixed with `'` to prevent
spreadsheet formula injection; finite numbers are written unquoted so they stay numeric.
No endpoint labels CSV bytes as `.xls`/`.xlsx`.

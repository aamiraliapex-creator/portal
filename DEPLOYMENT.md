# Deployment checklist

Run the migrations in Neon **before** deploying the code.

1. `migrations/neon-migration-sessions.sql`
2. `migrations/neon-migration-reminders.sql`
3. Review legacy payment dates that could not be converted:
   ```sql
   select count(*) from customers
    where next_payment is not null and trim(next_payment) <> '' and next_payment_date is null;
   ```
4. Set environment variables in Vercel, then deploy.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | pooled connection |
| `DIRECT_URL` | for migrations | unpooled |
| `AUTH_SECRET` | yes | >= 32 chars, fails closed |
| `CRON_SECRET` | yes for reminders | >= 32 chars, fails closed |

`RESEND_API_KEY` / `REMINDER_FROM_EMAIL` are **not used**. This release
delivers **in-app reminders only** — there is no email delivery.

## ⚠️ Cron frequency — read before relying on hearing reminders

`vercel.json` requests `*/15 * * * *`.

**Vercel Hobby runs cron only once per day.** On Hobby the 2-hour court
reminder **cannot work** and must not be treated as reliable. Choose one:

* **Vercel Pro** — the 15-minute schedule runs as configured; or
* **An external scheduler** (cron-job.org, GitHub Actions, Upstash QStash)
  calling the endpoint every 15 minutes:
  ```
  curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/reminders
  ```

### Verifying cron actually runs in production

1. Vercel dashboard → Project → **Cron Jobs**: confirm the job is listed and
   shows recent executions with HTTP 200.
2. Vercel → **Logs**, filter path `/api/cron/reminders`: you should see an
   invocation every 15 minutes.
3. Manually invoke with the bearer header and confirm a JSON body of counts
   (`created`, `delivered`, `escalated`, …). A 403 means the secret is wrong;
   503 means `CRON_SECRET` is unset or too short.
4. Schedule a test hearing ~3 hours out, wait for the next run, and confirm a
   `hearing` notification appears in the bell for the assigned agent.
5. If no executions appear within 30 minutes, the plan does not support the
   frequency — switch to an external scheduler before relying on reminders.

## Escalation

Unacknowledged **24-hour** reminders belonging to the **assigned agent** escalate
to management `ESCALATION_GRACE_MINUTES` (30) after actual delivery. Management's
own copies never trigger escalation, and an agent acknowledgement prevents it.

## Auditing existing hearing timezones

Existing `hearing_tz` values are **never rewritten automatically**: a genuine
Pacific hearing cannot be told apart from an old guessed one. Review them:

```sql
-- Grouped report of active hearings by state and stored timezone
select coalesce(state, '(none)')      as state,
       coalesce(hearing_tz, '(none)') as hearing_tz,
       count(*)                       as hearings,
       min(hearing_at)                as earliest,
       max(hearing_at)                as latest
  from cases
 where hearing_at is not null
   and coalesce(approval_status,'ACTIVE') = 'ACTIVE'
   and status not in ('Resolved','Dismissed','Cancelled')
 group by 1, 2
 order by hearings desc;

-- Rows most likely to carry a guessed Pacific value (state is not Pacific)
select id, citation, state, hearing_tz, hearing_at
  from cases
 where hearing_at is not null
   and hearing_tz = 'America/Los_Angeles'
   and coalesce(state,'') not in ('CA','WA','OR','NV','California','Washington','Oregon','Nevada')
 order by hearing_at;
```

Correct any wrong rows through the hearing edit form, which now requires an
explicit court timezone and reconciles reminders in the same transaction.

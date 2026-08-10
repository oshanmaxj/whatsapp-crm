# Campaign delivery worker deployment and recovery

The API starts the database-backed delivery worker unless `QUEUE_WORKER_ENABLED=false`.
PM2 must use `ecosystem.config.js`, which explicitly enables it. All clustered API workers may
consume the queue: PostgreSQL row locks with `SKIP LOCKED` prevent two live workers claiming the
same row, and stale claims become eligible after `QUEUE_PROCESSING_LEASE_MS`.

## Deploy

Perform the read-only inspection below **before** restarting a worker against an existing stuck
campaign. A worker restart makes unclaimed queued jobs eligible immediately.

```sh
cd backend
npm ci
npm run migrate
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

Confirm `queue_worker_started` appears once per PM2 instance and that each instance points to the
same production database. Never print access tokens or queue payloads while diagnosing campaigns.

## Inspect the affected campaign before recovery

Locate it from recent rows, rather than assuming an ID:

```sql
SELECT id,name,status,created_at,scheduled_at,started_at,last_progress_at,completed_at,
       whatsapp_account_id,whatsapp_template_id,total_recipients,last_error
FROM campaigns
WHERE deleted_at IS NULL AND name='Reminder'
ORDER BY created_at DESC LIMIT 10;
```

For the selected recent row, inspect the template/account, recipient totals, and queue leases in a
read-only transaction. Replace `:campaign_id` through the database client's parameter facility:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT wt.id,wt.name,wt.language,wt.status,wt.header_type,wt.whatsapp_account_id,
       wa.name AS account_name,wa.status AS account_status,wa.send_enabled
FROM campaigns c JOIN whatsapp_templates wt ON wt.id=c.whatsapp_template_id
JOIN whatsapp_accounts wa ON wa.id=c.whatsapp_account_id WHERE c.id=:campaign_id;
SELECT status,COUNT(*) FROM campaign_recipients WHERE campaign_id=:campaign_id GROUP BY status;
SELECT COUNT(*) AS recipient_rows FROM campaign_recipients WHERE campaign_id=:campaign_id;
SELECT id,campaign_recipient_id,status,claimed_at,locked_at,worker_id,attempts,max_attempts,
       next_attempt_at,last_error,error_details,external_message_id
FROM message_queue WHERE campaign_id=:campaign_id ORDER BY id;
COMMIT;
```

Also check for pre-existing duplicate jobs before migration 063. The migration intentionally stops
instead of silently weakening idempotency or deleting history:

```sql
SELECT campaign_id,campaign_recipient_id,COUNT(*)
FROM message_queue WHERE campaign_id IS NOT NULL AND campaign_recipient_id IS NOT NULL
GROUP BY campaign_id,campaign_recipient_id HAVING COUNT(*) > 1;
```

Correlate the campaign ID with `campaign_template_payload_ready`, `queue_worker_failed`, and Meta
request logs. Retain only request ID, campaign ID, error code/subcode, HTTP status and `fbtrace_id`.
The application cannot prove a historical transaction rollback from current rows alone; use the
database/audit logs to distinguish rollback from committed recipient and job rows.

## Recover without duplicate delivery

After confirming there is no external send evidence for stale rows, an authorized operator opens
Campaign Analytics and selects **Retry stuck/failed recipients**. The endpoint locks affected jobs,
requires `external_message_id IS NULL`, and refuses recipients already marked sent/delivered/read.
It is idempotent and preserves all history. Run it once, then observe persisted counters. It may be
run again safely if a worker crashes.

Verify with a controlled test broadcast before the production campaign: recipient rows equal the
intended audience, a job reaches `sent`, its recipient has an external message ID, and the campaign
reaches `Completed` or `Completed with failures`. Do not describe production as fixed until this
test and PM2 restart have completed and recipient-level delivery evidence exists.

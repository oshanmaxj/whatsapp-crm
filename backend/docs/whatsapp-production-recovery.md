# WhatsApp Cloud API production recovery

## Confirmed application findings

- The public webhook route mounted by Express is `GET|POST /api/webhooks/whatsapp`.
- Conversation-linked outbound sends resolve `conversations.whatsapp_account_id` and now use that database account's phone number ID and decrypted token as one atomic credential set.
- Previously, `whatsapp.service.js` and `whatsappAccount.service.js` could replace a database account's token and, on the default path, its phone number ID with global environment values. This could pair a phone number ID with a token from another Meta business and is a confirmed code cause of Graph error 100/subcode 33.
- The template route's canonical conversation query used unqualified `status` in a query joining another status-bearing table. It is now qualified as `"Conversation"."status"`, addressing PostgreSQL 42702 independently.
- Inbound messages already read `entry[].changes[].value.metadata.phone_number_id`; the repaired resolver no longer falls back to a different account. Unknown IDs are acknowledged with HTTP 200, logged only by their last four digits, and recorded as an admin notification.
- No Nginx configuration or production database is present in this repository. The operator must run the checks below on the production host before claiming the proxy, current database ID, current token ownership, or Meta subscription as verified.

## Production configuration audit (no secrets)

```sql
SELECT id, name, right(phone_number_id, 4) AS phone_id_last4,
       business_account_id IS NOT NULL AS has_waba_id,
       access_token_encrypted IS NOT NULL AND access_token_encrypted <> '' AS has_token,
       api_version, status, connection_status, send_enabled, is_default,
       last_verified_at, verified_name, quality_rating, connection_error
FROM whatsapp_accounts
ORDER BY is_default DESC, id;

SELECT count(*) AS active_defaults
FROM whatsapp_accounts
WHERE status = 'active' AND is_default = true;

SELECT c.id AS conversation_id, c.whatsapp_account_id,
       right(wa.phone_number_id, 4) AS configured_phone_id_last4,
       wa.status AS account_status, wa.connection_status
FROM conversations c
LEFT JOIN whatsapp_accounts wa ON wa.id = c.whatsapp_account_id
WHERE c.updated_at > now() - interval '7 days'
ORDER BY c.updated_at DESC
LIMIT 50;

SELECT id, direction, type, status, whatsapp_account_id, whatsapp_message_id,
       error_code, error_subcode, error_message, created_at
FROM messages
ORDER BY created_at DESC
LIMIT 100;

SELECT id, type, title, message, data, created_at
FROM notifications
WHERE type = 'whatsapp_configuration_alert'
ORDER BY created_at DESC
LIMIT 50;

SELECT m.id, m.direction, right(m.to_number, 4) AS to_last4,
       right(m.from_number, 4) AS from_last4, m.whatsapp_account_id,
       right(wa.phone_number_id, 4) AS account_phone_id_last4, m.created_at
FROM messages m
LEFT JOIN whatsapp_accounts wa ON wa.id = m.whatsapp_account_id
WHERE m.channel = 'whatsapp'
ORDER BY m.created_at DESC
LIMIT 100;
```

Use `GET /api/whatsapp-accounts/:id/diagnostic` as an authenticated administrator. It returns only the configuration source, database account ID, final four phone-ID digits, Graph version, token presence, active flag, and send-enabled flag.

## Route and proxy checks

```bash
cd /root/whatsapp-crm
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS https://api.firstofsolutions.com/api/health
curl -iG 'https://api.firstofsolutions.com/api/webhooks/whatsapp' \
  --data-urlencode 'hub.mode=subscribe' \
  --data-urlencode 'hub.verify_token=<VERIFY_TOKEN>' \
  --data-urlencode 'hub.challenge=crm-webhook-check'
curl -i -X POST 'https://api.firstofsolutions.com/api/webhooks/whatsapp' \
  -H 'Content-Type: application/json' \
  --data '{"object":"whatsapp_business_account","entry":[]}'
sudo nginx -T 2>&1 | grep -nE 'api\.firstofsolutions\.com|proxy_pass|client_max_body_size|X-Forwarded|webhooks'
```

Expected: both health checks return 200; the GET returns the exact challenge only with a configured verify token; the harmless empty POST returns 200. Nginx must forward `/api/` unchanged to the backend, retain the request body, set normal forwarded headers, and allow webhook/media body sizes used by this application.

## Deployment

```bash
cd /root/whatsapp-crm
git status --short
git pull --ff-only
cd backend
npm ci
npm run migrate:whatsapp-connection
node --test
pm2 restart whatsapp_crm_backend --update-env
pm2 save
pm2 logs whatsapp_crm_backend --lines 200 --nostream | grep -vEi 'access[_-]?token|authorization|bearer|app[_-]?secret'
cd ../frontend
npm ci
npm run build
```

The frontend rebuild is required because the account page now exposes the **Verify WhatsApp Connection** action. `npm ci` is safe for a lockfile-based deployment; no new dependency was added. Deploy the generated frontend build using the site's existing Nginx/static-release procedure.

## Secure credential correction and rotation

1. In Meta Business Settings, create or select the production system user and assign the intended WhatsApp Business Account/phone-number asset.
2. Generate a new permanent system-user token for the correct app/business with `whatsapp_business_messaging` and `whatsapp_business_management` permissions. Confirm the phone number belongs to the expected WABA and has not been deleted or replaced.
3. In the CRM WhatsApp Accounts admin page, update the exact database account linked to the affected conversations. Do not put the token in Git, a shell command, chat, logs, or `.env` if the database account is authoritative.
4. Run **Verify WhatsApp Connection**. It calls the selected Graph version's `GET /{PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,quality_rating`. Confirm connected status and the expected masked identity.
5. Restart the backend and worker with `pm2 restart whatsapp_crm_backend --update-env`, then `pm2 save`.
6. Revoke the terminal-exposed token in Meta immediately after the replacement is active. If compromise risk is high, revoke it before other work and accept the short outage.

## End-to-end checks

Outbound: verify the account, send free-form text inside the customer-service window, send an approved template, confirm a Meta message ID is stored, confirm the CRM renders it, and confirm sent/delivered/read webhook transitions.

Inbound: send from a real external number, confirm a webhook HTTP 200, confirm contact/conversation/message rows persist under the matching WhatsApp account, confirm the socket updates the open CRM, and send a reply.

## Rollback

Revert the deployment commit and restart `whatsapp_crm_backend`. The migration is additive; leaving its nullable verification/error columns in place is the safest rollback. Restore the previous frontend artifact. Do not restore the exposed token or the mixed environment/database resolution behavior. If columns must be removed, take a database backup first and run the migration's `down` method during a maintenance window.

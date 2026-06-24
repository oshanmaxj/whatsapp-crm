# First Of Education International Production Readiness

This CRM is prepared for one institute: First Of Education International. Do not add tenant IDs, tenant switching, SaaS billing, or multi-institute routing for this deployment.

## Company Profile

Default company settings are created as:

- Name: First Of Education International
- Phone: `COMPANY_PHONE`
- Email: `COMPANY_EMAIL`
- Address: `COMPANY_ADDRESS`

Check in production:

- Start the backend once.
- Open Settings.
- Confirm `company.profile` shows First Of Education International.
- Fill phone, email, and address if not provided in environment variables.

## WhatsApp Cloud API

Required production values:

- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN` when `WHATSAPP_SEND_ENABLED=true`
- `WHATSAPP_API_VERSION`
- `WHATSAPP_API_BASE_URL=https://graph.facebook.com`

Production webhook callback URL:

```text
https://<backend-domain>/api/webhooks/whatsapp
```

Webhook verification:

- Meta sends `hub.mode=subscribe`, `hub.verify_token`, and `hub.challenge`.
- The backend returns the challenge only when `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`.
- If `WHATSAPP_VERIFY_TOKEN` is missing, verification fails with a service configuration error.

## Inbound Lead Flow

Inbound WhatsApp message processing is configured as:

1. Receive Meta webhook at `/api/webhooks/whatsapp`.
2. Extract sender phone and WhatsApp profile name.
3. Find or create contact.
4. Find or create open lead for that contact.
5. Assign lead to an active agent using the existing round-robin assignment service.
6. Create or update a conversation using a per-contact WhatsApp thread key.
7. Create follow-up and notify assigned agent.
8. Store inbound message.

Production checks:

- At least one active agent user must exist.
- The active agent should have the `agent` role.
- Send a test WhatsApp message from a real phone.
- Confirm contact, lead, conversation, assignment, follow-up, and notification are created.

## Outbound Inbox Sending

Inbox outbound messages now use the existing WhatsApp service when:

```text
WHATSAPP_SEND_ENABLED=true
```

When enabled:

- The CRM sends text replies through WhatsApp Cloud API.
- The local message stores the returned WhatsApp message ID.
- No duplicate message row is created by the WhatsApp service for inbox sends.

When disabled:

- Inbox replies are stored locally as simulated/queued records.
- This is useful for staging and staff training.

## Campaign Sending

Campaigns remain in simulation mode unless:

```text
WHATSAPP_SEND_ENABLED=true
```

Before enabling real campaigns:

- Confirm Meta template/category requirements.
- Test with a small internal audience.
- Confirm opt-in/consent process.
- Confirm rate limits and account quality.

## Production Environment Checklist

Core:

- `NODE_ENV=production`
- `PORT`
- `FRONTEND_URL=https://<frontend-domain>`
- `TRUST_PROXY=true` when behind a proxy/load balancer
- `LOG_LEVEL=info`

Database:

- `DB_DIALECT=postgres`
- `DATABASE_URL`
- `DB_SSL=true` when required by host
- `DB_SSL_REJECT_UNAUTHORIZED=true` when provider certificates support it
- `DB_SYNC_ALTER=false`
- `DB_POOL_MAX`
- `DB_POOL_MIN`

Security:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES=15m`
- `JWT_REFRESH_EXPIRES=7d`
- `SESSION_TIMEOUT_MINUTES`
- `API_RATE_LIMIT_WINDOW_MS`
- `API_RATE_LIMIT_MAX`

Institute:

- `COMPANY_NAME=First Of Education International`
- `COMPANY_PHONE`
- `COMPANY_EMAIL`
- `COMPANY_ADDRESS`

WhatsApp:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_API_VERSION`
- `WHATSAPP_API_BASE_URL`
- `WHATSAPP_WEBHOOK_URL`
- `WHATSAPP_SEND_ENABLED=false` until real-send testing is approved

Admin:

- `ADMIN_EMAIL=admin@firstofeducation.com`
- `ADMIN_PASSWORD=<strong temporary password>`
- `ADMIN_FIRST_NAME=First Of Education`
- `ADMIN_LAST_NAME=Admin`

Frontend:

- `REACT_APP_API_URL=https://<backend-domain>/api`
- `REACT_APP_SOCKET_URL=https://<backend-domain>`

## Admin Setup

Run after production environment variables are set:

```bash
npm run db:seed:admin
```

Rules:

- `ADMIN_PASSWORD` must be at least 12 characters.
- Replace the temporary password after first login.
- Create active agent users before live WhatsApp testing.
- Assign agent users the `agent` role.
- Keep only trusted staff as system admins.

## Backup Checklist

Database:

- Enable automated daily backups.
- Enable point-in-time recovery if available.
- Test restore to a non-production database monthly.
- Keep migration history and backup timestamps together.

Uploads/media:

- Back up `backend/uploads` if local disk is used.
- Prefer durable object storage for production media.
- Verify restored files match media URLs stored in the database.

Secrets:

- Store environment variables in deployment secrets, not source control.
- Document emergency rotation for JWT secrets, WhatsApp token, and database credentials.

Recovery:

- Define RTO and RPO for First Of Education International.
- Keep restore steps for database, uploads, backend, and frontend.
- Monitor `/api/health`, webhook failures, queue backlog, 5xx responses, and database connection errors.

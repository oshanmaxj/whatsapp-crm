# Production Hardening Report

Date: 2026-06-24

## Optimization Report

### Implemented

- Added centralized JSON logging at `src/config/logger.js`.
- Routed HTTP access logs, Sequelize query logs, server startup failures, queue worker failures, socket handler failures, audit write failures, and WhatsApp integration failures through the centralized logger.
- Disabled automatic `sequelize.sync({ alter: true })` by default. It now only runs when `DB_SYNC_ALTER=true`.
- Added process-level monitoring for `unhandledRejection` and `uncaughtException`.
- Added lightweight authenticated GET caching for stable dashboard/production reads:
  - `GET /api/dashboard/summary` for 30 seconds.
  - `GET /api/queue/stats` for 10 seconds.
  - `GET /api/settings` for 60 seconds.
  - `GET /api/reports/summary` for 30 seconds.
- Added cache invalidation on non-GET API requests.
- Added missing query-aligned indexes:
  - `leads(owner_id, created_at)`, `leads(status_id, created_at)`, `leads(source_id, created_at)`, `leads(course_interested)`, `leads(created_at)`.
  - `contacts(status, created_at)`, `contacts(created_at)`.
  - `conversations(status, updated_at)`, `conversations(last_message_at)`, `conversations(updated_at)`.
  - `messages(conversation_id, created_at)`, `messages(conversation_id, is_read)`, `messages(created_at)`.
  - `message_queue(status, scheduled_at, priority)`, `message_queue(status, next_attempt_at)`.
  - `user_roles(user_id)`, `user_roles(role_id)`.
  - `role_permissions(role_id)`, `role_permissions(permission_id)`.
- Added those indexes to the idempotent migration runner so production can apply them with `npm run migrate`.

### Duplicate Code Findings

- CRUD controller/service patterns are repeated across contacts, leads, appointments, campaigns, workflows, education resources, and production resources. No new abstraction was added because the request forbids broad business-logic changes.
- Serialization code is repeated in several services. This is stable but should eventually move behind shared serializers if the API grows.
- CSV parsing/export logic exists inside contact service only, but it is custom code. If more CSV features are added, use one shared parser utility.
- WhatsApp send wrappers repeat message logging patterns. Kept intact to avoid changing integration behavior.

### Unused API Findings

- The current frontend service scan does not call the backend `/api/ai/*` endpoints. They may be reserved for direct API use or future UI integration.
- Webhook endpoints are intentionally not called by the frontend.
- No route was removed during this pass.

### Unused Model Findings

- Static reference scan found all model files referenced by the backend model registry and/or service layer.
- `RolePermission` and some audit/security models have low direct usage because they are mainly association or administrative tables, not dead code.
- `whatsapp.service.js` references `MediaFile`, but the registered model is `Media`. This is a likely latent bug in inbound media attachment saving and should be corrected after confirming intended table shape.

### Query Notes

- Pagination already exists for contacts and leads.
- High-cardinality dashboard counts are parallelized.
- Queue worker scans now have a compound index matching status, schedule, and priority ordering.
- Search uses `ILIKE` and concatenated name expressions; for large PostgreSQL datasets, plan a future trigram or generated-column search index.

## Security Report

### Implemented

- Disabled `X-Powered-By`.
- Added stricter Helmet configuration with production CSP basics, `frame-ancestors 'none'`, `object-src 'none'`, and same-site resource policy.
- Replaced open CORS defaults with an allowlist from comma-separated `FRONTEND_URL`.
- Added `credentials: true` CORS configuration for the existing token-based frontend flow.
- Added upload static-file hardening:
  - `X-Content-Type-Options: nosniff`.
  - Production cache headers for uploaded assets.
  - `fallthrough: false`.
- Added production validation requiring strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
- Added `TRUST_PROXY` env switch for deployments behind a proxy/load balancer.
- Error responses now include a `requestId`, hide internal messages for 500 responses outside development, and log full details centrally.

### Authenticated Route Verification

- Protected by `authMiddleware.authenticate`: users, auto replies, chat, AI, dashboard, contacts, leads, agents, conversations, media, notes, labels, templates, campaigns, workflows, appointments, production, education.
- Public by design: auth login/register/refresh/password reset, WhatsApp webhook verification/processing, health check.
- Risk: public registration remains enabled. For production, decide whether registration is invite/admin-only and gate it accordingly.

### Role Permission Verification

- `users` and `auto-replies` are admin-only.
- Most other authenticated routes currently allow any authenticated user.
- A permission middleware exists, and `roles`, `permissions`, and `role_permissions` models exist.
- Gap: no complete permission seed/catalog is present, so route-level permission enforcement cannot be safely enabled without risking lockouts.

### Security Gaps To Resolve Next

- Seed explicit permission codes and role mappings, then add route-level permission middleware per resource/action.
- Validate webhook authenticity if WhatsApp signature headers are available in production.
- Add request-size limits per upload/import endpoint rather than relying only on global JSON limits.
- Confirm whether password reset delivery is implemented and whether reset tokens are expired/rotated as expected.
- Replace the development seed password before production use.

## Deployment Report

### Production Deployment Checklist

- Set `NODE_ENV=production`.
- Set `DB_SYNC_ALTER=false`; run migrations explicitly instead of automatic schema alteration.
- Run `npm install --omit=dev` in `backend` and production build in `frontend`.
- Run `npm run migrate` before starting the backend.
- Confirm the migration output shows the production hardening indexes as added or skipped.
- Confirm database SSL settings match hosting provider requirements.
- Set `TRUST_PROXY=true` when behind Nginx, a platform proxy, or load balancer.
- Configure `FRONTEND_URL` to the deployed frontend origin, not localhost.
- Configure process supervision with restart policy and log collection.
- Verify `/api/health` after deployment.
- Verify login, dashboard summary, contact/lead list, WhatsApp webhook, queue processing, and socket connection.
- Ensure uploaded files are stored on durable storage or backed up if local disk is used.

### Environment Variable Checklist

- Required runtime:
  - `NODE_ENV`
  - `PORT`
  - `FRONTEND_URL`
  - `DB_DIALECT`
  - `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
  - `JWT_ACCESS_SECRET`
  - `JWT_REFRESH_SECRET`
- Security/runtime tuning:
  - `JWT_ACCESS_EXPIRES`
  - `JWT_REFRESH_EXPIRES`
  - `SESSION_TIMEOUT_MINUTES`
  - `API_RATE_LIMIT_WINDOW_MS`
  - `API_RATE_LIMIT_MAX`
  - `TRUST_PROXY`
  - `LOG_LEVEL`
- Database tuning:
  - `DB_SSL`
  - `DB_SSL_REJECT_UNAUTHORIZED`
  - `DB_CONNECT_TIMEOUT`
  - `DB_POOL_MAX`
  - `DB_POOL_MIN`
  - `DB_POOL_ACQUIRE`
  - `DB_POOL_IDLE`
  - `DB_POOL_EVICT`
  - `DB_SYNC_ALTER`
- Optional integrations:
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_VERIFY_TOKEN`
  - `WHATSAPP_API_VERSION`
  - `WHATSAPP_API_BASE_URL`
  - `WHATSAPP_SEND_ENABLED`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `STORAGE_UPLOAD_DIR`
  - `STORAGE_PUBLIC_URL`
- Frontend:
  - `REACT_APP_API_URL`
  - `REACT_APP_SOCKET_URL`

### Backup And Disaster Recovery Checklist

- Database:
  - Schedule automated daily full backups.
  - Add point-in-time recovery if the hosting provider supports WAL/archive logs.
  - Test restore into a non-production environment at least monthly.
  - Encrypt backups at rest and restrict restore credentials.
  - Keep retention windows aligned to business/legal requirements.
- Files/uploads:
  - Back up `uploads` or move uploads to durable object storage.
  - Verify restore preserves file paths/URLs used by media records.
- Secrets/config:
  - Store production env vars in a secrets manager or deployment platform secrets.
  - Keep a documented emergency secret-rotation procedure for JWT and WhatsApp/OpenAI tokens.
- Application recovery:
  - Document RTO/RPO targets.
  - Keep migration rollback notes for every schema change.
  - Keep a tested procedure for restoring DB, uploads, and redeploying backend/frontend.
  - Monitor health endpoint, 5xx rate, queue backlog, database connection errors, and webhook failures.

# WhatsApp number access and queue bulk removal

Migration `064_user_whatsapp_access_and_queue_bulk_remove.js` adds `users.all_whatsapp_accounts` and the normalized `user_whatsapp_accounts` join table. The flag defaults to `true`, so every existing user keeps legacy all-number access after deployment. Administrators are always unrestricted. Saving a user with “Allow all WhatsApp numbers” disabled changes the flag to `false`; from then on only the explicitly selected active account IDs are allowed. An empty restricted set is rejected by the administration UI and is deny-all at the server boundary.

The shared WhatsApp account access service applies this scope to the existing Inbox/conversation, lead, campaign, flow, report, account-selector, and Call Center paths that already consume it. Call Center queue listing now adds the same account predicate. Routing candidates must pass the user-level account boundary; a configured global fallback cannot cross it and an unassigned routing record records the exclusion reason.

`POST /api/call-center/queue/bulk-remove` accepts `{ "queueEntryIds": [1,2,3] }` (maximum 1,000 IDs) and returns `requestedCount`, `removedCount`, `skippedCount`, `failures`, and `removedIds`. Missing, duplicate, completed, or previously removed IDs are skipped, making retries idempotent. Foreign queues and inaccessible account entries are reported per item. Rows are status-transitioned to `removed`; leads, contacts, conversations, messages, calls, and histories are untouched, and one audit record captures the operation.

## Deployment

1. Deploy backend code capable of both legacy and migrated access behavior.
2. From `backend`, run `npm run migrate`.
3. Restart the backend processes (`pm2 reload ecosystem.config.js` where PM2 is used).
4. Build and deploy the frontend with `npm ci && npm run build`.
5. Configure explicit number restrictions user by user and verify Inbox and Call Center with a restricted test agent.

## Rollback

Roll back application code first. Migration 064 is intentionally additive and its `down` does not drop security assignments. Keeping the flag and join rows is safe for the older application and avoids losing administrator configuration. Drop them only in a separately reviewed maintenance migration after exporting `user_whatsapp_accounts`; do not remove the columns while the new application is running.

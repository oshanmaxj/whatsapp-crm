# Advanced Flow Triggers and Button Actions

## Architecture

Flow definitions remain stored in `flows.trigger_config` and `flow_nodes.config_json`. Existing nodes are not rewritten. Legacy reply buttons are interpreted as `CONTINUE_FLOW`; legacy URL and phone fields are mapped when the node is edited.

Runtime responsibilities are separated into:

- `flowTriggerMatcher.service.js`: Unicode/whitespace normalization, source/scope matching, keyword modes, and privileged regex matching.
- `flowAction.service.js`: ordered pre/post execution, failure policies, idempotency, audit sanitization, assignments, labels, lists, sequences, custom fields, integrations, and flow-control actions.
- `flow.service.js`: stable interactive payload mapping, trigger selection, canonical run context, child-flow orchestration, cycle/depth checks, and parent resumption.
- `flow_action_executions`: durable per-message/run/node/button/action idempotency and sanitized audit results.
- `flow_run_links`: parent/child run relationships. The child uses the existing contact, account, and canonical conversation.

External actions enforce HTTPS, reject embedded credentials, resolve DNS, block private/link-local targets, do not follow redirects, and send only explicitly selected sanitized context fields.

Regular WhatsApp reply buttons can return a stable payload for automations, but they cannot natively open URLs or initiate calls. Native URL/phone CTAs require supported approved templates, and URL CTA clicks do not return a button-press webhook. Publish validation and the builder show warnings for this limitation.

## Compatibility and audit

No flow is unpublished or rewritten by migration `040_advanced_flow_actions.js`. Run the report-only audit after deployment:

```bash
cd /root/whatsapp-crm/backend
npm run audit:flow-actions
```

Exit status is `0` when clean, `2` when validation issues are reported, and `1` on an audit failure. The command never changes flow data.

## Deployment

```bash
cd /root/whatsapp-crm
git status --short
git pull --ff-only

cd backend
npm ci
npm run migrate
npm run audit:flow-actions
node --test
pm2 restart whatsapp_crm_backend --update-env
pm2 save
curl -fsS https://api.firstofsolutions.com/api/health

cd ../frontend
npm ci
npm test -- --watchAll=false --runInBand
npm run build
```

Publish `frontend/build` with the VPS's existing atomic Nginx/static release procedure. Run `npm run db:seed:access` if the deployment does not already execute access-default seeding; this creates the new `flows.*` permissions and grants them to the Admin role.

## End-to-end checklist

1. Open an existing published flow and verify all nodes, edges, and legacy buttons are unchanged.
2. Create exact, contains, Sinhala, first-message, button-reply, and list-reply triggers; use trigger simulation before publishing.
3. Add ordered pre/post label, list, sequence, assignment, and custom-field actions. Confirm execution logs contain no secrets.
4. Configure two identical button titles on different nodes and verify each stable payload invokes only its own action.
5. Start a published child flow. Confirm both runs share contact ID, WhatsApp account ID, and conversation ID, and `flow_run_links` records the relationship.
6. Retry the same Meta webhook payload and confirm there is one run/action execution per idempotency key.
7. Test the same contact on two WhatsApp accounts and confirm runs and Inbox updates remain isolated.
8. Test an optional failing integration and confirm the inbound message and conversation remain stored.
9. Confirm inactive agents and cross-account target flows are rejected.
10. Confirm live Inbox updates stay on the canonical conversation.

## Rollback

Deploy the previous application revision and restart the backend. Restore the previous frontend artifact. Leave the additive tables and `custom_fields` columns in place; older code ignores them and retaining audit/run-link history is safer. If schema removal is mandatory, first back up PostgreSQL, stop flow workers, run migration `040_advanced_flow_actions.js` down during a maintenance window, and then restart the previous revision. Existing JSON flow definitions require no data rollback.

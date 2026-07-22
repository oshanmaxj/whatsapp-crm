# WhatsApp number-based lead routing

## Architecture

Inbound webhooks resolve `metadata.phone_number_id` to one active `WhatsAppAccount`. Canonical contact, conversation, lead, and inbound message persistence happens before routing. `whatsappLeadRouting.service.js` then routes with the immutable identity `{ whatsappAccountId, contactId, conversationId, leadId }`; it never substitutes the default account.

Routing reuses `leadAssignment.service.js`, so the lead owner, all conversations for that lead, lead assignment/activity history, conversation assignment history, internal assignment event, audit record, and WebSocket assignment events stay synchronized. Payment slips, receipts, flows, LMS behavior, and message delivery remain downstream of the same canonical conversation.

## Database schema

- `whatsapp_routing_rules`: one enabled, non-deleted default rule per account (enforced by a PostgreSQL partial unique index), strategy, department, capacity, sticky behavior, fallbacks, notification settings, and the rule-local round-robin cursor.
- `whatsapp_routing_rule_agents`: unique rule/agent membership with enabled state, weight, priority, and optional capacity override.
- `whatsapp_routing_unassigned_queue`: unresolved inbound routing cases and safe exclusion diagnostics.
- `users.is_available`, `users.leave_until`, and `users.working_hours`: additive availability fields. Working hours use `{ "timezone":"Asia/Colombo", "days": { "mon":[{"start":"09:00","end":"17:00"}] } }`.

Department foreign keys reference `roles`, which is the CRM's existing department entity. No historical assignment is changed by the migration.

## Routing order and locking

1. Keep an explicit conversation owner.
2. When sticky ownership is enabled, find the most recent owner for the same contact and the same WhatsApp account.
3. Lock the enabled rule for the exact account.
4. Evaluate enabled pool members for active status, availability, leave, optional working hours, department/account access, and capacity.
5. Try the configured fallback agent, then fallback department.
6. Use the legacy global auto-assignment only when `allow_global_fallback` is true.
7. Otherwise leave the lead unassigned, enqueue it, and notify the configured manager (or the administrator notification audience when no manager is selected).

PostgreSQL `pg_advisory_xact_lock(whatsappAccountId)` plus row locks serialize selection for each number. Workload counts and ownership writes occur in the same transaction. A rule never silently selects a user outside its configured pool; only explicit fallback settings can broaden it.

## Assignment strategies

- `least_open_chats` (default): smallest open/pending conversation count; ties use priority then agent ID.
- `round_robin`: advances through the ordered pool using the rule-local cursor.
- `least_assigned_leads`: smallest active lead count.
- `weighted`: smallest historical assignment-count/weight ratio.
- `specific_agent`: selects only the configured fallback/specific agent.
- `manual`: always queues the lead without assigning it.

## Permissions and APIs

Admins receive `whatsapp_routing.view`, `.create`, `.edit`, `.delete`, `.test`, and `.manage_agents` during migration. Other roles require explicit grants. Account access is checked independently of endpoint permission.

Management lives under `/api/whatsapp-accounts/:accountId/routing`. The test endpoint is non-mutating by default; `simulate=false` additionally requires edit permission and complete canonical IDs. Its response contains rule, eligible/excluded agents and reasons, selected agent, strategy, and fallback status—never account credentials.

The analytics endpoint reports account-scoped received, assigned, unassigned and converted leads, conversion rate, distribution, and open workload. The UI appears in **WhatsApp Numbers → Edit → Lead Routing** and is permission-aware.

## Deployment

Run from the VPS after taking normal application/database backups:

```bash
cd /root/whatsapp-crm/backend
npm ci
npm run migrate
npm run audit:whatsapp-routing
npm test

cd /root/whatsapp-crm/frontend
npm ci
npm test -- --watchAll=false
npm run build

cd /root/whatsapp-crm
pm2 restart whatsapp_crm_backend --update-env
pm2 restart whatsapp_crm_frontend --update-env
pm2 save
pm2 status whatsapp_crm_backend whatsapp_crm_frontend
```

The migration and frontend rebuild are both required. Configure rules before expecting automatic assignment; accounts without a rule intentionally enter the unassigned queue.

## Verification SQL

```sql
SELECT a.id, a.name, r.id AS rule_id, r.assignment_strategy, r.is_enabled
FROM whatsapp_accounts a LEFT JOIN whatsapp_routing_rules r
  ON r.whatsapp_account_id = a.id AND r.deleted_at IS NULL;

SELECT r.whatsapp_account_id, r.id AS rule_id, m.agent_id, m.is_enabled, m.weight, m.max_open_chats
FROM whatsapp_routing_rules r JOIN whatsapp_routing_rule_agents m ON m.routing_rule_id = r.id
WHERE r.deleted_at IS NULL ORDER BY r.whatsapp_account_id, r.id, m.priority DESC, m.agent_id;

SELECT whatsapp_account_id, status, count(*) FROM whatsapp_routing_unassigned_queue
GROUP BY whatsapp_account_id, status ORDER BY whatsapp_account_id, status;

SELECT whatsapp_account_id, count(*) FROM whatsapp_routing_rules
WHERE is_enabled AND deleted_at IS NULL GROUP BY whatsapp_account_id HAVING count(*) > 1;
```

## Audit and safe repair

`npm run audit:whatsapp-routing` is report-only. `npm run audit:whatsapp-routing -- --apply` performs only one unambiguous repair: it resolves open queue records whose linked lead already has an owner. It never moves a lead, changes a pool, or rewrites history.

## Rollback

Prefer an application rollback while retaining the additive tables and columns; this preserves audit/history data and avoids destructive schema work. Disable every routing rule to stop number-based assignment. If schema removal is mandatory, first back up PostgreSQL, verify the old application is running, then drop the partial index and the three routing tables in dependency order during a maintenance window. Do not drop user availability columns until all application nodes run the old model. The migration intentionally has a no-op `down` method to prevent accidental data loss.

## Troubleshooting and end-to-end checklist

- Unknown phone number ID: verify the Meta payload and `whatsapp_accounts.phone_number_id`; do not set a default-account workaround.
- No selected agent: inspect `/routing/test`, queue exclusions, enabled membership, availability/leave, working-hours timezone, account-role mapping, and capacities.
- Duplicate-rule error: disable the existing rule before enabling another.
- Unexpected sticky result: confirm both `contact_id` and `whatsapp_account_id`; ownership never crosses numbers.
- Capacity appears stale: verify conversation states are `open` or `pending` and that all nodes use PostgreSQL transactions.

Before release, test two numbers with disjoint pools, a shared contact across both numbers, sticky ownership, every strategy, capacity and working-hours exclusions, agent leave/unavailability, both fallbacks, manual/no-agent queueing, simultaneous inbound messages, assignment socket payloads, manager notification, permissions, credential-free API responses, payment slip/receipt handling, flows, and a production frontend build.

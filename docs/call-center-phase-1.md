# Call Center Performance — Phase 1 Design

## Existing-system findings

- `lead_status` is the canonical configurable status table; leads reference it through `status_id`.
- `lead_activities` and `audit_logs` are immutable activity/audit ledgers already used by status and assignment services.
- `followups` already supports pending, completed, rescheduled, and cancelled work.
- leads already retain owner, course interest, next follow-up, and conversion actor/time.
- assignment changes synchronize Leads and Chat and write history.
- APIs use authenticated Express routes; authorization is permission-code based.
- React uses a central module navigation configuration and permission-protected routes.
- no PBX/3CX call-event integration or reliable presence ledger exists.

## Phase 1 workflow

1. Agent opens Call Center or a lead and starts a manual call.
2. Server creates one open, agent-reported call using server time and rejects another active call.
3. Agent ends the call and must select disposition and next lead status.
4. Server transaction completes the call, validates status requirements, changes lead status, writes immutable status/activity/audit history, and optionally schedules a follow-up.
5. A transition to Registered creates one idempotent conversion-attribution row.
6. Supervisors view reconciled KPIs derived from call, follow-up, status-history, and conversion rows.

## Additive database changes

- Extend `lead_status` with category, requirement/KPI flags, and allowed-next-status IDs.
- Add `call_activities` for agent-reported or provider-confirmed calls.
- Add `lead_status_history` for normalized transition and aging reporting.
- Add `conversion_attributions` with a unique lead/course attribution key.
- No existing rows are deleted or reset. Migration 048 is restart-safe.

## APIs

- `POST /api/call-center/calls/start`
- `POST /api/call-center/calls/:id/complete`
- `POST /api/call-center/calls/log`
- `GET /api/call-center/dashboard`
- `GET /api/call-center/agents`
- `GET /api/call-center/agents/:id/performance`
- `GET /api/call-center/agents/:id/timeline`
- `GET /api/call-center/follow-ups`
- `GET /api/leads/:id/timeline`

All timestamps are server-authored UTC values. Date filters are interpreted using Asia/Colombo boundaries.

## UI route/wireframe

`/call-center`

```
[Date] [Agent] [Course] [Source] [Status] [Disposition] [Refresh]
[Calls] [Contacted] [Answered] [Follow-ups] [Conversions] [Contact %] [Conversion %]
[Start/log call panel]              [Agent performance table]
[Recent call activity]              [Metric definitions]
```

Phase 1 adds a focused call-center page and call outcome dialog. Existing Leads/Chat/Student pages remain authoritative for their existing workflows.

## KPI definitions

- Total call attempts: completed call rows in the period.
- Unique leads contacted: distinct leads with a completed call.
- Answered calls: dispositions counted as successful contact.
- Contact rate: contacted unique leads / attempted unique leads.
- Conversions: distinct attributed leads.
- Conversion rate: converted unique leads / eligible unique assigned leads, never call count.
- Average talk time: total talk seconds / answered calls.
- Average handling time: total completed call duration / completed calls.
- Follow-up compliance: completed due follow-ups / all due follow-ups.

Test/deleted leads are excluded where the existing lead model identifies them.

## Risks and migration plan

- Existing seven statuses remain valid; new workflow statuses are not force-inserted during Phase 1.
- Allowed transitions default to unrestricted until supervisors configure them.
- Historical lead activities are preserved; normalized history starts with new transitions.
- Manual calls are always `agent_reported`; provider confirmation is reserved for Phase 3.
- Deploy migration before application restart. Rollback does not delete business data.

## Phase 1 implementation plan

1. Add idempotent schema and permissions.
2. Add models/associations and transactional call service.
3. Reuse canonical lead-status and follow-up services.
4. Add dashboard/timeline endpoints.
5. Add permission-protected React route and call workflow.
6. Verify call concurrency, required follow-up, immutable history, attribution idempotency, KPI reconciliation, and build.

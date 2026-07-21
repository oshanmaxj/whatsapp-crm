# CRM labels, voice, template diagnostics, and dashboards

## Canonical ownership and attribution

Labels remain in `labels` and are assigned only through `conversation_labels`. A lead exposes labels from its canonical conversation: active (`open`/`pending`) first, then an explicit `lead_id` match, then the most recently updated conversation. No lead-label copy is maintained.

Lead conversions belong to `leads.owner_id` (the assigned agent) and are identified by the canonical `registered` lead status. Revenue and commission belong to `agent_commissions.agent_user_id`; `lead_id`, `student_id`, `payment_id`, and `attribution_source` preserve the audit chain. The user who clicks a payment or registration button does not replace the attributed agent.

## Dashboard and leaderboard definitions

- Assigned leads: distinct non-deleted leads whose `owner_id` is in the authorized scope.
- Converted leads: assigned leads whose canonical status code is `registered`.
- Replies: outbound messages with `sent_by_user_id` in the selected business-timezone range.
- Unique conversations: distinct `conversation_id` among those outbound replies.
- Open chats: non-deleted `open` or `pending` conversations assigned to the agent.
- Follow-up completion: completed follow-ups divided by follow-ups due in the range.
- Revenue/commission: sums from canonical `agent_commissions` attribution rows.
- Ties: equal weighted scores share a rank; the following rank is skipped (competition ranking).
- Exclusions: disabled, deleted, and system-admin users are excluded.

Score (0–100-oriented): `45% conversion rate + 25% follow-up completion rate + up to 20 points from distinct conversations + 10 points from revenue normalized to the visible cohort`. Raw message count does not affect score.

## Performance checks

After representative production statistics are available, run `EXPLAIN (ANALYZE, BUFFERS)` for the lead label `EXISTS` filter and the aggregate leaderboard query. Verify use of:

- `conversation_labels_label_conversation_idx`
- `conversation_labels_conversation_assigned_idx`
- `messages_sender_created_idx`
- `followups_assignee_status_due_idx`
- `leads_owner_converted_idx`

## Deployment

```bash
cd /path/to/crm/backend
npm ci
FFMPEG_PATH=/usr/bin/ffmpeg npm run migrate
npm test
cd ../frontend
npm ci
CI=true npm test -- --watchAll=false --runInBand
npm run build
sudo systemctl restart crm-backend
```

FFmpeg is required only to convert Chrome WebM voice recordings to Meta-compatible OGG/Opus. MP4/M4A and supported OGG recordings pass through unchanged.

## Verification SQL

```sql
SELECT code FROM permissions WHERE code IN ('labels.create','labels.assign','labels.remove','voice.send','templates.send','dashboard.view_own','dashboard.view_team','dashboard.view_all','dashboard.view_financial','dashboard.view_agent_ranking','dashboard.configure_widgets') ORDER BY code;
SELECT indexname FROM pg_indexes WHERE indexname IN ('conversation_labels_label_conversation_idx','conversation_labels_conversation_assigned_idx','messages_sender_created_idx','followups_assignee_status_due_idx','leads_owner_converted_idx');
SELECT lower(trim(name)), count(*) FROM labels GROUP BY lower(trim(name)) HAVING count(*) > 1;
SELECT l.id, l.owner_id, l.converted_at, ls.code FROM leads l JOIN lead_statuses ls ON ls.id=l.status_id WHERE ls.code='registered' ORDER BY l.converted_at DESC NULLS LAST LIMIT 20;
SELECT agent_user_id, lead_id, attribution_source, sum(gross_payment_amount), sum(commission_amount) FROM agent_commissions GROUP BY agent_user_id, lead_id, attribution_source ORDER BY agent_user_id LIMIT 50;
SELECT id, template_name, whatsapp_account_id, error_code, error_subcode, error_message, status_updated_at FROM messages WHERE error_code='131048' ORDER BY status_updated_at DESC LIMIT 20;
```

## Production checklist

1. Create `Physical Workshop` in Flow Builder, select it immediately, save, reload, and confirm the stored node contains its numeric ID.
2. Trigger the flow and confirm the chip appears in Inbox, Lead list, and Lead detail.
3. Test any/all/no-label server filters with pagination.
4. Verify a label-use-only user cannot create, and a user lacking assign/remove cannot mutate labels.
5. At 320px and 390px widths, check attachment, templates, emoji, input, microphone, and send remain reachable with quick replies present and the keyboard open.
6. Record and send voice from desktop Chrome, Android Chrome, and iPhone Safari; reload and replay it. Confirm WebM returns the explicit conversion error if FFmpeg is intentionally unavailable.
7. Send a valid approved template and confirm the exact conversation account, phone-number ID, WABA, language, and components in diagnostics.
8. Reproduce/simulate Meta 131048 and confirm the persisted failure, clear UI text, and absence of an automatic retry.
9. Compare agent, manager, and admin dashboard scopes; verify financial widgets are unavailable rather than zero when denied.
10. Convert a lead owned by Agent A while logged in as an admin and verify conversion, revenue, and commission remain attributed to Agent A.
11. Verify leaderboard date ranges, shared-rank ties, disabled-user exclusion, team scope, and pagination.

## Rollback

Deploy the previous application build first. Migration 042 is additive, so leaving its permissions and indexes is safe. If policy requires removal, revoke the new role-permission mappings before deleting permission rows, then drop only the five named indexes above. Do not delete `labels` or `conversation_labels`; they are pre-existing canonical CRM data. Voice files already sent should remain in media storage so historical playback continues to work.

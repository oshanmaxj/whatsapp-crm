# Inbound WhatsApp conversation recovery

## Root cause

`Message` defines the JavaScript attribute `conversationId` with the database field
`conversation_id`. The conversation association also declared the foreign key as the
literal attribute name `conversation_id`. Sequelize therefore registered two model
attributes for one PostgreSQL column. The association-injected attribute could replace
the value supplied as `conversationId` when generating an insert. The same duplicate
mapping affected `whatsapp_account_id` and reply-message associations.

The associations now use `{ name: <camelCase>, field: <snake_case> }`. Inbound message
persistence also requires contact, conversation, WhatsApp account, WhatsApp message ID,
and a transaction before it queries or inserts. A missing conversation throws so the
identity transaction rolls back. Socket emission remains after the identity transaction
has committed.

## Deploy

```bash
cd /path/to/application
git pull --ff-only
cd backend
npm install
node --test test/inboundWhatsappConversationPersistence.test.js test/inboundWhatsappContact.test.js test/identityAndStudentNumbers.test.js test/whatsappConnection.test.js
pm2 restart <backend-process-name> --update-env
pm2 logs <backend-process-name> --lines 100
```

No schema migration is required for the mapping correction.

## Backfill

First run the report-only mode:

```bash
cd /path/to/application/backend
npm run backfill:inbound-whatsapp-conversations
```

Review every `ambiguous` and `unmatched` entry. Apply only the unambiguous matches:

```bash
npm run backfill:inbound-whatsapp-conversations -- --apply
```

The script runs in one transaction, matches on exact `contact_id` and
`whatsapp_account_id`, updates only messages with exactly one active conversation, and
leaves ambiguous or unmatched rows unchanged. Re-running it is safe because it only
selects rows whose `conversation_id` is still null.

## Verification SQL

```sql
SELECT
  m.id,
  m.whatsapp_message_id,
  m.contact_id,
  m.whatsapp_account_id,
  m.conversation_id,
  m.created_at
FROM messages AS m
WHERE m.direction = 'inbound'
  AND m.channel = 'whatsapp'
  AND m.deleted_at IS NULL
  AND m.conversation_id IS NULL
ORDER BY m.created_at DESC;
```

To review unresolved candidate counts without changing data:

```sql
SELECT
  m.id AS message_id,
  m.contact_id,
  m.whatsapp_account_id,
  COUNT(c.id) AS candidate_count,
  ARRAY_REMOVE(ARRAY_AGG(c.id ORDER BY c.id), NULL) AS candidate_conversation_ids
FROM messages AS m
LEFT JOIN conversations AS c
  ON c.contact_id = m.contact_id
 AND c.whatsapp_account_id = m.whatsapp_account_id
 AND c.deleted_at IS NULL
WHERE m.direction = 'inbound'
  AND m.channel = 'whatsapp'
  AND m.deleted_at IS NULL
  AND m.conversation_id IS NULL
GROUP BY m.id, m.contact_id, m.whatsapp_account_id
ORDER BY m.id;
```

# Inbound WhatsApp contact identity recovery

## Root cause

The previous inbound resolver searched phone, normalized phone, and WhatsApp ID in one `OR` query. If normalized phone selected contact B while the inbound WhatsApp ID was already owned by contact A, it updated B's `whatsapp_id`. The model and production schema require `contacts.whatsapp_id` to be unique, so PostgreSQL rejects that update with `23505` (normally the `contacts_whatsapp_id_key` constraint; use the query below to obtain the exact production name).

The resolver also caught conversation uniqueness failures and queried again inside the same PostgreSQL transaction. PostgreSQL transactions remain aborted after a constraint error, so the follow-up query produced `25P02: current transaction is aborted` and obscured the original `23505`.

The repaired flow locks the WhatsApp ID, canonical phone, and account/phone identity; resolves exact WhatsApp ownership first; records conflicts without deleting contacts; and retries a uniqueness race only by starting a fresh transaction after rollback. Contact, conversation, and inbound message persistence share one transaction. Lead assignment, notifications, sockets, media processing, and automations occur after commit.

## Production schema and conflict audit

```sql
SELECT con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'contacts'
  AND pg_get_constraintdef(con.oid) ILIKE '%whatsapp_id%';

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'contacts'
  AND indexdef ILIKE '%whatsapp_id%';

SELECT id, right(whatsapp_id, 4) AS whatsapp_id_last4,
       right(normalized_phone, 4) AS normalized_phone_last4,
       whatsapp_account_id, deleted_at
FROM contacts
WHERE id = 3;

SELECT phone_contact.id AS phone_contact_id,
       whatsapp_owner.id AS whatsapp_owner_contact_id,
       right(phone_contact.normalized_phone, 4) AS identity_last4,
       phone_contact.whatsapp_account_id AS phone_contact_account_id,
       whatsapp_owner.whatsapp_account_id AS owner_account_id
FROM contacts phone_contact
JOIN contacts whatsapp_owner
  ON whatsapp_owner.whatsapp_id = phone_contact.normalized_phone
 AND whatsapp_owner.id <> phone_contact.id
WHERE phone_contact.deleted_at IS NULL
  AND whatsapp_owner.deleted_at IS NULL
ORDER BY phone_contact.id;

SELECT normalized_phone, array_agg(id ORDER BY id) AS contact_ids, count(*)
FROM contacts
WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL
GROUP BY normalized_phone
HAVING count(*) > 1;

SELECT c.id AS conversation_id, c.contact_id, c.assigned_user_id,
       c.whatsapp_account_id, right(c.normalized_phone, 4) AS phone_last4
FROM conversations c
WHERE c.contact_id IN (
  SELECT phone_contact.id
  FROM contacts phone_contact
  JOIN contacts whatsapp_owner
    ON whatsapp_owner.whatsapp_id = phone_contact.normalized_phone
   AND whatsapp_owner.id <> phone_contact.id
)
ORDER BY c.updated_at DESC;
```

## Safe cleanup recommendations

Do not drop the WhatsApp ID uniqueness constraint and do not delete either contact automatically. For each warning, confirm the two rows represent the same person, select the WhatsApp-ID owner as canonical, and review leads, students, conversations, notes, assignments, and accounting references before moving anything. Preserve `assigned_user_id` and assignment history. Perform any approved merge in a maintenance transaction with both contact rows locked, take a database backup first, and retain an audit record mapping the duplicate ID to the canonical ID.

The application already links new inbound traffic to the WhatsApp-ID owner and emits an admin notification of type `whatsapp_contact_identity_conflict`, so cleanup can be performed separately without blocking messages.

## Deployment

```bash
cd /root/whatsapp-crm
git pull --ff-only
cd backend
npm ci
node --test test/inboundWhatsappContact.test.js test/identityAndStudentNumbers.test.js test/whatsappConnection.test.js
pm2 restart whatsapp_crm_backend --update-env
pm2 save
pm2 logs whatsapp_crm_backend --lines 200 --nostream | grep -E 'whatsapp_inbound_contact|whatsapp_identity_transaction|whatsapp_webhook_processing'
```

No database migration or new dependency is required for this repair.

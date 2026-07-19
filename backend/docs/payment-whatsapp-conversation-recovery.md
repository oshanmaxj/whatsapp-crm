# Payment WhatsApp conversation identity and recovery

## Root cause

Payment confirmation automation retained the student/contact but discarded the inbound conversation and WhatsApp account. `message_queue` therefore sent with fallback credentials, then `outboundHistory.service` independently looked up or created a conversation with a null/default account. Payment-slip acknowledgements also omitted their source conversation, and receipt jobs selected the latest conversation by contact only. A contact with multiple accounts or an older conversation could consequently receive the Meta send on one account while CRM history was saved to another newly created conversation.

The 24-hour customer-service window was also mixed into receipt conversation selection. That window decides whether free-form content may be sent; it is not conversation identity.

## Canonical resolution rules

`resolveCanonicalWhatsAppConversation` resolves in this order:

1. A non-archived explicit preferred conversation.
2. The source inbound message conversation.
3. The payment-slip conversation.
4. An active `contact_id + whatsapp_account_id` conversation.
5. A prior conversation with that exact contact/account pair, reopened when necessary.
6. A new conversation only when none of the above exists.

A contact-only match is never sufficient. If the account cannot be inferred unambiguously, delivery fails before Meta is called. Payment, installment, receipt, receipt job, and queue rows carry the canonical conversation/account. Outbound history is inserted as `pending` before delivery, completed with the Meta message ID after success, and emitted to the same conversation room only after persistence.

## Audit before repair

```sql
SELECT contact_id, whatsapp_account_id, COUNT(*) AS active_conversations,
       array_agg(id ORDER BY id) AS conversation_ids
FROM conversations
WHERE whatsapp_account_id IS NOT NULL
  AND status IN ('open', 'pending')
  AND deleted_at IS NULL
GROUP BY contact_id, whatsapp_account_id
HAVING COUNT(*) > 1
ORDER BY active_conversations DESC;
```

Review payment and receipt references:

```sql
SELECT c.id, c.contact_id, c.whatsapp_account_id, c.status,
       COUNT(DISTINCT m.id) AS messages,
       COUNT(DISTINCT ps.id) AS payment_slips,
       COUNT(DISTINCT pr.id) AS receipts
FROM conversations c
LEFT JOIN messages m ON m.conversation_id = c.id
LEFT JOIN payment_slips ps ON ps.conversation_id = c.id
LEFT JOIN payment_receipts pr ON pr.conversation_id = c.id
WHERE c.whatsapp_account_id IS NOT NULL
GROUP BY c.id
ORDER BY c.contact_id, c.whatsapp_account_id, c.id;
```

## Repair utility

The command is report-only unless `--apply` is supplied:

```bash
cd backend
npm run repair:payment-whatsapp-conversations
npm run repair:payment-whatsapp-conversations -- --apply
```

The utility locks each duplicate identity group, chooses the conversation with the strongest inbound history (then most recent activity), moves messages and payment/receipt references, preserves a compatible assignment, archives duplicates, refreshes the canonical preview, and creates the partial unique index once no active duplicates remain. Conflicting user or role assignments are reported and skipped instead of guessed. It is idempotent and never hard-deletes conversations.

After repair:

```sql
SELECT COUNT(*) AS duplicate_identity_groups
FROM (
  SELECT contact_id, whatsapp_account_id
  FROM conversations
  WHERE whatsapp_account_id IS NOT NULL
    AND status IN ('open', 'pending') AND deleted_at IS NULL
  GROUP BY contact_id, whatsapp_account_id
  HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS orphaned_payment_outbound
FROM messages
WHERE direction = 'outbound'
  AND message_type IN ('payment_receipt', 'payment_slip_acknowledgement', 'automation')
  AND (conversation_id IS NULL OR whatsapp_account_id IS NULL);
```

## Deployment

```bash
git pull --ff-only
cd backend
npm ci
npm run migrate
node --test test/paymentWhatsappConversationIdentity.test.js test/paymentReceipt.test.js test/whatsappPaymentSlip.test.js
npm run repair:payment-whatsapp-conversations
# Review the report and assignment conflicts before applying:
npm run repair:payment-whatsapp-conversations -- --apply
pm2 restart whatsapp-crm-backend --update-env
```

## Rollback

Stop the worker, deploy the previous application revision, and restart it. Do not drop the new context columns: they are additive audit data. The repair archives duplicates rather than deleting them; a reviewed rollback can restore one by setting its status back to `open` only after moving its references back and ensuring the partial unique identity constraint will not be violated. Take a database snapshot before applying repair in production.

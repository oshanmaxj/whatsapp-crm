# Payment receipt generation and recovery

## Architecture

`accounting_transactions.id` is the canonical `payment_id`. A confirmed fee payment
creates that income transaction first. Receipt generation then locks the payment,
resolves the linked fee/installment/student/course/batch, takes immutable snapshots,
allocates a number through `payment_receipt_counters`, writes the receipt and audit row,
and commits. PDF and WhatsApp work runs afterward through `payment_receipt_jobs`.

Flow:

1. Confirm/manual payment commits its canonical income transaction and fee balances.
2. `generatePaymentReceipt` locks the payment and returns an existing active receipt on retry.
3. The per-year counter atomically allocates `RCPT-YEAR-000001`.
4. Snapshot receipt and required audit row commit together.
5. A persistent job generates a private PDF using PDFKit and QRCode.
6. Optional WhatsApp delivery uploads the private PDF directly to Meta and sends it with
   the WhatsApp account linked to the student's conversation.

The public token is 256 random bits. Only its SHA-256 hash and AES-GCM encrypted form are
stored. The verification response never returns database IDs, phone numbers, internal
notes, payment-slip data, or the PDF.

## Migration

`038_payment_receipts.js` creates:

- `payment_receipts`
- `payment_receipt_counters`
- `payment_receipt_jobs`
- receipt indexes, permissions, partial active-payment uniqueness, and default settings

Migration rollback intentionally retains financial history. Roll back application code,
not receipt tables, during an incident.

## Settings

Environment fallbacks:

```dotenv
RECEIPT_PREFIX=RCPT
RECEIPT_COMPANY_NAME=First Of Education International (PVT) Ltd
RECEIPT_COMPANY_REGISTRATION_NUMBER=PV 00267065
RECEIPT_CURRENCY=LKR
RECEIPT_AUTO_GENERATE=true
RECEIPT_AUTO_SEND_WHATSAPP=true
RECEIPT_VERIFICATION_BASE_URL=https://crm.firstofsolutions.com/receipt/verify
RECEIPT_TOKEN_ENCRYPTION_KEY=<independent-long-random-secret>
RECEIPT_PRIVATE_ROOT=/srv/first-of-education/private/payment-receipts
```

CRM receipt settings override these values and provide company address, phone, email,
logo, signature/stamp, footer, automation switches, and verification base URL.

## Permissions

- `receipts.view`
- `receipts.generate`
- `receipts.download`
- `receipts.send_whatsapp`
- `receipts.regenerate`
- `receipts.void`
- `receipts.export`
- `receipts.manage_settings`

Admin receives all permissions. Accountant receives all receipt permissions. Manager
receives operational permissions but not void/settings permissions by default.

## Deployment

```bash
cd /srv/first-of-education
git pull --ff-only
cd backend
npm ci
npm run migrate
node --test test/paymentReceipt.test.js
cd ../frontend
npm ci
npm test -- --watchAll=false
npm run build
cd ../backend
pm2 restart <backend-process-name> --update-env
pm2 logs <backend-process-name> --lines 150
```

The private receipt directory must be writable by the backend service account and must
not be exposed through Nginx, Express static middleware, or a public object-storage bucket.

## Backfill

Report only:

```bash
cd /srv/first-of-education/backend
npm run backfill:payment-receipts
```

Create receipt records only:

```bash
npm run backfill:payment-receipts -- --apply
```

Create records and PDFs:

```bash
npm run backfill:payment-receipts -- --apply --generate-pdf
```

WhatsApp delivery is deliberately opt-in and requires PDF generation:

```bash
npm run backfill:payment-receipts -- --apply --generate-pdf --send-whatsapp
```

The backfill skips existing receipts, unapproved payments, and ambiguous payment-to-
installment relationships. It is safe to rerun.

## Verification SQL

```sql
-- Active receipt uniqueness and canonical payment linkage
SELECT payment_id, COUNT(*)
FROM payment_receipts
WHERE status = 'ACTIVE' AND deleted_at IS NULL
GROUP BY payment_id
HAVING COUNT(*) > 1;

-- Approved fee payments still missing receipt history
SELECT at.id AS payment_id, fi.id AS installment_id, fi.status
FROM accounting_transactions at
JOIN fee_installments fi ON fi.accounting_transaction_id = at.id
LEFT JOIN payment_receipts pr ON pr.payment_id = at.id
WHERE at.type = 'income'
  AND fi.status IN ('confirmed', 'paid')
  AND pr.id IS NULL
ORDER BY at.id;

-- PDF and WhatsApp processing status
SELECT receipt_number, status, pdf_storage_key IS NOT NULL AS pdf_ready,
       whatsapp_sent_at, whatsapp_message_id
FROM payment_receipts
ORDER BY receipt_date DESC, id DESC;

-- Failed asynchronous work
SELECT id, receipt_id, job_type, attempts, max_attempts, last_error, run_after
FROM payment_receipt_jobs
WHERE status = 'FAILED'
ORDER BY updated_at DESC;
```

## End-to-end checklist

1. Confirm a pending fee payment and verify exactly one receipt is returned.
2. Repeat confirmation/generation and verify the same receipt number is returned.
3. Confirm simultaneous payments and verify unique sequential receipt numbers.
4. Open Accounting > Receipts and test filters, view and CSV export.
5. Download the PDF with an authorized finance user.
6. Verify an unauthorized user receives HTTP 403.
7. Inspect the PDF snapshots, totals, masked phone/reference, QR and footer.
8. Scan the QR while logged out and confirm only safe verification fields appear.
9. Send inside the WhatsApp service window and verify one Meta message ID is saved.
10. Retry the automatic job and verify no duplicate automatic send occurs.
11. Attempt outside the service window and verify the template-required message.
12. Manually resend and verify an audit row is created.
13. Void with and without permission/reason; verify the number remains and VOID is public.
14. Reverse the canonical payment and verify the receipt becomes REVERSED.
15. Edit the live student/course after generation and verify the PDF snapshots do not change.

## Rollback

1. Disable automation with `RECEIPT_AUTO_GENERATE=false` and
   `RECEIPT_AUTO_SEND_WHATSAPP=false` or the corresponding CRM settings.
2. Stop receipt job processing by setting a long worker interval and restarting the backend.
3. Revert only the receipt application commit and rebuild/restart the services.
4. Do not drop or truncate receipt, counter, job, or audit tables.
5. Preserve the private PDF directory for finance/audit recovery.
6. After a corrected deployment, restart the worker; queued/failed jobs are retry-safe.

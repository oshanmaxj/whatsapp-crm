# Interactive WhatsApp media headers

## Root cause

The Flow Builder read an interactive-header file into a browser `data:` URL and stored it as `headerMediaUrl`. At runtime `flow.service.js` passed that value to `whatsapp.service.js`, which generated `header.<type>.link = "data:..."`. Meta cannot fetch browser data URLs. The flow media upload endpoint was only used by standalone image nodes, and the interactive path never converted the selected file to an account-scoped Meta media ID.

## Supported combinations

| Interactive type | None | Text | Image | Video | Document |
| --- | --- | --- | --- | --- | --- |
| Reply buttons | Yes | Yes | Yes | Yes | Yes |
| List | Yes | Yes | No | No | No |

Media headers never contain `caption`. Documents may contain a sanitized `filename`.

## Runtime flow

1. Resolve the canonical conversation and its exact WhatsApp account.
2. Validate header type, MIME, byte size, and safe filename.
3. Store the source below `FLOW_MEDIA_PRIVATE_ROOT` (default `backend/private/flow-media`), never below public `/uploads`.
4. Upload with the selected account's phone-number ID, token, and Graph version using `POST /{PHONE_NUMBER_ID}/media` multipart fields `messaging_product`, `type`, and `file`.
5. Persist the returned media ID together with its WhatsApp account ID and private local reference.
6. Build the interactive header using the Meta media ID object.
7. Create/reuse a pending CRM message, send to Meta, save the returned `wamid`, mark sent, and emit the canonical-conversation event.
8. On failure, retain the failed message with sanitized Meta code, subcode, type, and message.

When a flow executes under a different account, its private source is uploaded again for that account and the foreign media ID is never reused.

## Payload examples

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<recipient>",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": { "type": "image", "image": { "id": "<META_MEDIA_ID>" } },
    "body": { "text": "Choose an option" },
    "action": { "buttons": [{ "type": "reply", "reply": { "id": "yes", "title": "Yes" } }] }
  }
}
```

Video replaces the header with `{ "type": "video", "video": { "id": "<META_MEDIA_ID>" } }`. Document uses `{ "type": "document", "document": { "id": "<META_MEDIA_ID>", "filename": "report.pdf" } }`. Text uses `{ "type": "text", "text": "Header" }`.

## Deployment

```bash
cd /root/whatsapp-crm
git status --short
git pull --ff-only

cd backend
npm ci
npm run migrate
node --test test/whatsappInteractiveMedia.test.js
node --test
pm2 restart whatsapp_crm_backend --update-env
pm2 save
curl -fsS https://api.firstofsolutions.com/api/health

cd ../frontend
npm ci
npm test -- --watchAll=false --runInBand
npm run build
```

Ensure the backend process can write `FLOW_MEDIA_PRIVATE_ROOT`, and preserve that private directory between releases. Publish `frontend/build` using the existing atomic Nginx/static release procedure.

## End-to-end checks

1. From Inbox, send button messages with no header, text, JPG/PNG, MP4, and PDF headers.
2. Confirm the pending bubble becomes sent only after Meta returns a `wamid`.
3. Force an invalid Meta response and confirm the same CRM message becomes failed with a safe error.
4. In Flow Builder, upload image/video/document headers and confirm previews, progress, remove, and replace behavior.
5. Run the flow on its configured account and inspect the received WhatsApp header.
6. Change/reuse a global flow under another account and confirm a separate media upload occurs.
7. Confirm list messages do not offer or send media headers.
8. Confirm `backend/private/flow-media` is not reachable through `/uploads`.
9. Inspect logs for last-four diagnostics only; confirm tokens, full media IDs, private paths, and full recipient numbers are absent.

## Rollback

Deploy the previous backend and frontend revisions and restart the backend. The change adds no database schema. Retain `backend/private/flow-media` during rollback so a later redeployment can reuse stored sources. After a verified backup and only if the feature will not be redeployed, the scoped private flow-media directory may be removed during a maintenance window.

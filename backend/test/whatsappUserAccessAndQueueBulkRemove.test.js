const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('migration keeps legacy users unrestricted and stores explicit assignments normalized',()=>{
 const migration=read('migrations/064_user_whatsapp_access_and_queue_bulk_remove.js');
 assert.match(migration,/all_whatsapp_accounts/);
 assert.match(migration,/defaultValue: true/);
 assert.match(migration,/user_whatsapp_accounts/);
 assert.match(migration,/user_whatsapp_accounts_user_account_uq/);
 assert.doesNotMatch(migration,/comma|CSV/i);
});

test('shared access boundary uses user IDs, denies direct access, and preserves admin access',()=>{
 const access=read('src/services/whatsappAccountAccess.service.js');
 assert.match(access,/user\.allWhatsappAccounts !== false/);
 assert.match(access,/user\.whatsappAccounts/);
 assert.match(access,/status: 403/);
 assert.match(access,/context\.unrestricted \? null/);
});

test('queue bulk removal is one permission-gated idempotent endpoint',()=>{
 const routes=read('src/routes/callCenter.routes.js'),service=read('src/services/callQueue.service.js');
 assert.match(routes,/queue\/bulk-remove/);
 assert.match(routes,/call_queue\.bulk_remove/);
 for(const field of ['requestedCount','removedCount','skippedCount','failures'])assert.ok(service.includes(field));
 assert.match(service,/status:\{\[Op\.in\]:activeStatuses\}/);
 assert.match(service,/CALL_QUEUE_BULK_REMOVED/);
 assert.doesNotMatch(service,/Lead\.destroy|Contact\.destroy|Conversation\.destroy/);
});

test('queue list and routing enforce the same hard WhatsApp account boundary',()=>{
 const queue=read('src/services/callQueue.service.js'),routing=read('src/services/whatsappLeadRouting.service.js');
 assert.match(queue,/whereForUser\(actor\.id,'whatsappAccountId'\)/);
 assert.match(routing,/agent\.allWhatsappAccounts === false/);
 assert.match(routing,/account_access_denied/);
 assert.match(routing,/global_fallback_blocked_by_whatsapp_access_boundary/);
});

test('responsive queue UI provides selection, confirmation and stale-entry recovery',()=>{
 const page=read('../frontend/src/pages/CallCenterPage.jsx');
 for(const label of ['Select all visible','Clear selection','Remove selected','selected leads from My Queue?'])assert.ok(page.includes(label));
 assert.match(page,/response\?\.status===404/);
 assert.match(page,/already removed/);
});

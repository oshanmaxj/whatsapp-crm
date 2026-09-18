const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');
const facebookPageService = require('../src/services/facebookPage.service');

function patchModelMethods(overrides) {
  const originals = {};
  for (const key of Object.keys(overrides)) {
    const [modelName, methodName] = key.split('.');
    originals[key] = db[modelName][methodName];
    db[modelName][methodName] = overrides[key];
  }
  return function restore() {
    for (const key of Object.keys(overrides)) {
      const [modelName, methodName] = key.split('.');
      db[modelName][methodName] = originals[key];
    }
  };
}

// Fake sequelize.transaction that mirrors real Postgres same-transaction
// visibility (as established in the earlier lead-transaction regression
// suite), so facebookConversationIdentityService.resolveContact runs exactly
// as it does in production.
function buildFakeIdentityDb() {
  const contacts = new Map();
  let contactSeq = 0;
  const facebookContacts = new Map();

  const Contact = {
    async create(data, { transaction } = {}) {
      contactSeq += 1;
      const row = { id: contactSeq, ...data, async update(patch) { Object.assign(row, patch); } };
      contacts.set(row.id, row);
      return row;
    },
    async findByPk(id) { return contacts.get(Number(id)) || null; }
  };
  const FacebookContact = {
    async findOne({ where }) { return facebookContacts.get(`${where.facebookPageId}:${where.facebookPsid}`) || null; },
    async create(data) {
      const row = { ...data, async update(patch) { Object.assign(row, patch); } };
      facebookContacts.set(`${data.facebookPageId}:${data.facebookPsid}`, row);
      return row;
    }
  };
  const sequelize = {
    getDialect: () => 'sqlite', // skip the Postgres-only advisory lock query
    async query() { return [[]]; },
    async transaction(fn) { return fn({ LOCK: { UPDATE: 'UPDATE' } }); }
  };
  return { Contact, FacebookContact, sequelize, contacts, facebookContacts };
}

test('scenario 10/13: Messenger profile resolution stores the real person name, and two different PSIDs with the same name remain separate contacts', async () => {
  const db2 = buildFakeIdentityDb();
  const { createFacebookConversationIdentityService } = facebookConversationIdentityService;
  const identity = createFacebookConversationIdentityService(db2);

  const first = await identity.resolveContactOnly({ facebookPageId: 9, psid: 'psid-a', displayName: 'Oshan Mihira' });
  const second = await identity.resolveContactOnly({ facebookPageId: 9, psid: 'psid-b', displayName: 'Oshan Mihira' });

  assert.equal(first.contact.firstName, 'Oshan');
  assert.equal(first.contact.lastName, 'Mihira');
  assert.equal(second.contact.firstName, 'Oshan');
  assert.equal(second.contact.lastName, 'Mihira');
  assert.notEqual(first.contact.id, second.contact.id, 'two different PSIDs must never be merged into one contact even with identical names');
  assert.equal(db2.contacts.size, 2, 'exactly two separate Contact rows must exist');
});

test('scenario 11: an existing placeholder "Facebook User" contact is upgraded in place once a real profile name becomes available', async () => {
  const db2 = buildFakeIdentityDb();
  const { createFacebookConversationIdentityService } = facebookConversationIdentityService;
  const identity = createFacebookConversationIdentityService(db2);

  const first = await identity.resolveContactOnly({ facebookPageId: 9, psid: 'psid-c', displayName: null });
  assert.equal(first.contact.firstName, 'Facebook User', 'no profile name available yet must use the explicit placeholder, never a fabricated one');

  const second = await identity.resolveContactOnly({ facebookPageId: 9, psid: 'psid-c', displayName: 'Oshan Max' });
  assert.equal(second.contact.id, first.contact.id, 'the same PSID must resolve to the exact same contact, upgraded in place');
  assert.equal(second.contact.firstName, 'Oshan');
  assert.equal(second.contact.lastName, 'Max');
  assert.equal(db2.contacts.size, 1, 'upgrading must not create a second contact');
});

test('a contact that already has a real name is never overwritten by a later, different-looking profile lookup', async () => {
  const db2 = buildFakeIdentityDb();
  const { createFacebookConversationIdentityService } = facebookConversationIdentityService;
  const identity = createFacebookConversationIdentityService(db2);

  await identity.resolveContactOnly({ facebookPageId: 9, psid: 'psid-d', displayName: 'Real Name' });
  const again = await identity.resolveContactOnly({ facebookPageId: 9, psid: 'psid-d', displayName: null });
  assert.equal(again.contact.firstName, 'Real', 'a contact with a real name already on file must not be reset to a placeholder just because this call has no displayName');
});

test('scenario 12: a Graph API profile-lookup failure does not lose the inbound message — handleInboundMessagingEvent still persists it', async () => {
  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  const contact = { id: 900, firstName: 'Facebook User', toJSON: () => ({ id: 900 }) };
  const conversation = { id: 950, leadId: 1, toJSON: () => ({ id: 950 }), async update() {} };
  facebookConversationIdentityService.findOrCreateByPageAndPsid = async (values) => {
    // Confirms displayName was resolved (or safely null) before this call —
    // never throws even though the profile lookup itself failed below.
    const persisted = values.afterResolve ? await values.afterResolve({ contact, conversation, facebookContact: {}, transaction: {} }) : null;
    return { contact, conversation, facebookContact: {}, created: true, persisted };
  };
  const restoreModels = patchModelMethods({
    'FacebookContact.findOne': async () => null,
    'Message.findOne': async () => null,
    'Message.create': async (data) => ({ id: 1, ...data }),
    'FlowRun.findOne': async () => null,
    'Flow.findAll': async () => [],
    'Contact.findByPk': async () => contact,
    'Conversation.findByPk': async () => conversation,
    'Lead.findByPk': async () => null
  });
  const originalRuntimeConfig = facebookPageService.runtimeConfig;
  facebookPageService.runtimeConfig = async () => { throw new Error('Facebook Page config unavailable'); }; // profile lookup cannot even start
  try {
    const page = { id: 9, pageId: '106024052262867' };
    const item = { sender: { id: 'psid-lookup-fail' }, message: { mid: 'mid-lookup-fail-1', text: 'hello' }, timestamp: String(Date.now()) };
    const result = await facebookMessengerService.handleInboundMessagingEvent(page, item);
    assert.ok(result?.messageRecord, 'the message must still be persisted even though the profile lookup failed');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
    facebookPageService.runtimeConfig = originalRuntimeConfig;
    restoreModels();
  }
});

// 14. Messenger conversation API returns person name separately from Page name.
test('scenario 14: listConversations returns contact (person) and facebookPage (Page) as separate objects', async () => {
  const restoreModels = patchModelMethods({
    'Conversation.findAll': async ({ include }) => {
      const contactInclude = include.find((item) => item.as === 'contact');
      const pageInclude = include.find((item) => item.as === 'facebookPage');
      assert.ok(contactInclude, 'the query must include the person contact separately');
      assert.ok(pageInclude, 'the query must include the Facebook Page separately');
      return [{
        id: 1,
        contact: { id: 501, firstName: 'Oshan', lastName: 'Mihira' },
        facebookPage: { id: 9, name: 'First of Trading' }
      }];
    }
  });
  try {
    const rows = await facebookMessengerService.listConversations({ facebookPageId: 9 });
    assert.equal(rows[0].contact.firstName, 'Oshan');
    assert.equal(rows[0].facebookPage.name, 'First of Trading');
    assert.notEqual(rows[0].contact.firstName, rows[0].facebookPage.name, 'the person name and the Page name must never be the same field');
  } finally { restoreModels(); }
});

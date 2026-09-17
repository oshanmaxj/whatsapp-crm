const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const leadService = require('../src/services/lead.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const flowService = require('../src/services/flow.service');

// Reproduces the production incident: facebook_identity_transaction_failed /
// "insert or update on table \"leads\" violates foreign key constraint
// \"leads_contact_id_fkey\"". Root cause: Contact.create runs inside the
// identity service's own transaction, but the Lead lookup/create that follows
// it (inside afterResolve) ran WITHOUT that transaction. On Postgres, a
// statement issued without an explicit transaction (or in a different one)
// cannot see rows a still-open transaction has written but not committed, so
// the FK check on leads.contact_id fails even though `contact.id` is a real,
// freshly-minted id. This fake models exactly that visibility rule: a row
// inserted under a given transaction object is visible to later statements
// that reuse the SAME transaction object, but invisible to any statement that
// omits it (or in Postgres terms: runs on a different connection/snapshot)
// until that transaction commits. It also models that Postgres sequences
// (contacts.id) advance even when the surrounding transaction rolls back,
// which is why production logs showed contactId 6035 then 6036 with neither
// contact ever actually persisted.
function fkViolation() {
  return Object.assign(
    new Error('insert or update on table "leads" violates foreign key constraint "leads_contact_id_fkey"'),
    { name: 'SequelizeForeignKeyConstraintError', parent: { code: '23503', constraint: 'leads_contact_id_fkey', table: 'leads' } }
  );
}

function buildFakeDb(startingContactId = 6034) {
  let contactSeq = startingContactId;
  let conversationSeq = 900;
  let leadSeq = 500;
  const committedContacts = new Map();
  const facebookContacts = new Map();
  const conversations = new Map();
  const committedLeads = [];

  const Contact = {
    async create(data, { transaction } = {}) {
      contactSeq += 1;
      const row = { id: contactSeq, ...data };
      if (!transaction) throw new Error('test harness: Contact.create requires a transaction');
      transaction.pendingContacts.set(row.id, row);
      return row;
    },
    async findByPk(id, { transaction } = {}) {
      return (transaction && transaction.pendingContacts.get(id)) || committedContacts.get(id) || null;
    }
  };

  const FacebookContact = {
    async findOne({ where }) {
      return facebookContacts.get(`${where.facebookPageId}:${where.facebookPsid}`) || null;
    },
    async create(data) {
      const row = { ...data, async update(updates) { Object.assign(row, updates); } };
      facebookContacts.set(`${data.facebookPageId}:${data.facebookPsid}`, row);
      return row;
    }
  };

  const Conversation = {
    async findOne({ where }) {
      return conversations.get(where.facebookThreadKey) || null;
    },
    async create(data) {
      conversationSeq += 1;
      const row = { id: conversationSeq, ...data, async update(updates) { Object.assign(row, updates); } };
      conversations.set(data.facebookThreadKey, row);
      return row;
    }
  };

  const Lead = {
    async create(data, { transaction } = {}) {
      const contactVisible = transaction
        ? committedContacts.has(data.contactId) || transaction.pendingContacts.has(data.contactId)
        : committedContacts.has(data.contactId);
      if (!contactVisible) throw fkViolation();
      leadSeq += 1;
      const row = { id: leadSeq, ...data };
      committedLeads.push(row);
      return row;
    },
    async findOne({ where }) {
      return committedLeads.find((lead) => lead.contactId === where.contactId
        && (!where.facebookPageId || lead.facebookPageId === where.facebookPageId)) || null;
    }
  };

  const LeadStatus = { async findOne({ where }) { return { id: 1, name: 'New', code: where.code, active: true }; } };
  const LeadSource = { async findOne({ where }) { return { id: 1, name: where.name }; } };
  const Message = {
    async findOne() { return null; },
    async create(data) { return { id: 1, ...data }; }
  };

  const sequelize = {
    async query() { return [[]]; }, // no-op stand-in for the Postgres advisory lock
    async transaction(fn) {
      const tx = { pendingContacts: new Map(), LOCK: { UPDATE: 'UPDATE' } };
      const result = await fn(tx); // rejection here propagates and nothing below runs (rollback)
      for (const [id, row] of tx.pendingContacts) committedContacts.set(id, row);
      return result;
    }
  };

  return {
    Contact, FacebookContact, Conversation, Lead, LeadStatus, LeadSource, Message, sequelize,
    committedContacts, committedLeads
  };
}

function patchModels(fakeDb) {
  const originals = {
    sequelizeQuery: db.sequelize.query,
    sequelizeTransaction: db.sequelize.transaction,
    contactCreate: db.Contact.create,
    contactFindByPk: db.Contact.findByPk,
    facebookContactFindOne: db.FacebookContact.findOne,
    facebookContactCreate: db.FacebookContact.create,
    conversationFindOne: db.Conversation.findOne,
    conversationCreate: db.Conversation.create,
    leadCreate: db.Lead.create,
    leadFindOne: db.Lead.findOne,
    leadStatusFindOne: db.LeadStatus.findOne,
    leadSourceFindOne: db.LeadSource.findOne,
    messageFindOne: db.Message.findOne,
    messageCreate: db.Message.create,
    flowHandleDomainEvent: flowService.handleDomainEvent
  };

  db.sequelize.query = fakeDb.sequelize.query;
  db.sequelize.transaction = fakeDb.sequelize.transaction;
  db.Contact.create = fakeDb.Contact.create;
  db.Contact.findByPk = fakeDb.Contact.findByPk;
  db.FacebookContact.findOne = fakeDb.FacebookContact.findOne;
  db.FacebookContact.create = fakeDb.FacebookContact.create;
  db.Conversation.findOne = fakeDb.Conversation.findOne;
  db.Conversation.create = fakeDb.Conversation.create;
  db.Lead.create = fakeDb.Lead.create;
  db.Lead.findOne = fakeDb.Lead.findOne;
  db.LeadStatus.findOne = fakeDb.LeadStatus.findOne;
  db.LeadSource.findOne = fakeDb.LeadSource.findOne;
  db.Message.findOne = fakeDb.Message.findOne;
  db.Message.create = fakeDb.Message.create;
  flowService.handleDomainEvent = async () => {}; // irrelevant fire-and-forget side effect for this bug

  return function restore() {
    db.sequelize.query = originals.sequelizeQuery;
    db.sequelize.transaction = originals.sequelizeTransaction;
    db.Contact.create = originals.contactCreate;
    db.Contact.findByPk = originals.contactFindByPk;
    db.FacebookContact.findOne = originals.facebookContactFindOne;
    db.FacebookContact.create = originals.facebookContactCreate;
    db.Conversation.findOne = originals.conversationFindOne;
    db.Conversation.create = originals.conversationCreate;
    db.Lead.create = originals.leadCreate;
    db.Lead.findOne = originals.leadFindOne;
    db.LeadStatus.findOne = originals.leadStatusFindOne;
    db.LeadSource.findOne = originals.leadSourceFindOne;
    db.Message.findOne = originals.messageFindOne;
    db.Message.create = originals.messageCreate;
    flowService.handleDomainEvent = originals.flowHandleDomainEvent;
  };
}

test('reproduces the production bug: Lead lookup/create without the active transaction violates leads_contact_id_fkey and rolls back the contact', async () => {
  const fakeDb = buildFakeDb(6034);
  const restore = patchModels(fakeDb);
  try {
    const capturedContactIds = [];

    async function buggyAfterResolve({ contact }) {
      // Deliberately mirrors the pre-fix code: omits the active `transaction`.
      capturedContactIds.push(contact.id);
      let lead = await leadService.getOpenLeadForContactAndFacebookPage(contact.id, 1);
      if (!lead) lead = await leadService.createLead(contact.id, { source: 'Facebook', facebookPageId: 1 });
      return { leadId: lead.id };
    }

    await assert.rejects(
      facebookConversationIdentityService.findOrCreateByPageAndPsid({
        facebookPageId: 1, psid: 'psid-bug-1', displayName: null, afterResolve: buggyAfterResolve
      }),
      (error) => error.parent?.code === '23503' && error.parent?.constraint === 'leads_contact_id_fkey'
    );

    await assert.rejects(
      facebookConversationIdentityService.findOrCreateByPageAndPsid({
        facebookPageId: 1, psid: 'psid-bug-2', displayName: null, afterResolve: buggyAfterResolve
      }),
      (error) => error.parent?.code === '23503'
    );

    // Matches the production log sequence exactly: contactId 6035, then 6036 —
    // incrementing even though neither contact was ever actually persisted.
    assert.deepEqual(capturedContactIds, [6035, 6036]);
    assert.equal(fakeDb.committedContacts.size, 0, 'no contact should have survived the rolled-back transaction');
    assert.equal(fakeDb.committedLeads.length, 0, 'no lead should have been created');
  } finally {
    restore();
  }
});

test('fix: facebookMessenger.service.handleInboundMessagingEvent forwards the active transaction, so the Lead is created without an FK violation', async () => {
  const fakeDb = buildFakeDb(7034);
  const restore = patchModels(fakeDb);
  try {
    const page = { id: 1 };
    const item = {
      sender: { id: 'psid-fixed-1' },
      message: { text: 'Hello from Messenger', mid: 'mid-fixed-1' },
      timestamp: String(Date.now())
    };

    const result = await facebookMessengerService.handleInboundMessagingEvent(page, item);

    assert.ok(result?.messageRecord, 'expected the inbound message to be persisted');
    assert.equal(fakeDb.committedContacts.size, 1, 'the contact must be committed');
    assert.equal(fakeDb.committedLeads.length, 1, 'exactly one lead must be created');
    const [contact] = fakeDb.committedContacts.values();
    const [lead] = fakeDb.committedLeads;
    assert.equal(lead.contactId, contact.id, 'the lead must reference the committed contact id');
    assert.equal(result.conversation.leadId, lead.id, 'the conversation must be linked to the new lead');

    // A second inbound message on the same thread must reuse the same lead
    // instead of hitting the same FK path again.
    const second = await facebookMessengerService.handleInboundMessagingEvent(page, {
      sender: { id: 'psid-fixed-1' },
      message: { text: 'Second message', mid: 'mid-fixed-2' },
      timestamp: String(Date.now())
    });
    assert.ok(second?.messageRecord);
    assert.equal(fakeDb.committedLeads.length, 1, 'no duplicate lead should be created for the same open conversation');

    // Each call above scheduled a fire-and-forget flow-trigger dispatch via
    // setImmediate; drain the queue so those run against the patched (no-op)
    // flow service before `restore()` puts the real one back, instead of
    // leaking a real DB-connection attempt past the end of this test.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    restore();
  }
});

test('lead.service.createLead and getOpenLeadForContactAndFacebookPage forward an explicit transaction to Sequelize', async () => {
  const originalCreate = db.Lead.create;
  const originalFindOne = db.Lead.findOne;
  const originalStatusFindOne = db.LeadStatus.findOne;
  const originalSourceFindOne = db.LeadSource.findOne;
  const marker = { id: 'fake-transaction-marker' };
  try {
    db.LeadStatus.findOne = async ({ where }) => ({ id: 1, name: 'New', code: where.code, active: true });
    db.LeadSource.findOne = async ({ where }) => ({ id: 1, name: where.name });

    let createOptions;
    db.Lead.create = async (data, options) => { createOptions = options; return { id: 42, ...data }; };
    const lead = await leadService.createLead(99, { source: 'Facebook', facebookPageId: 1, transaction: marker });
    assert.equal(lead.id, 42);
    assert.equal(createOptions.transaction, marker, 'createLead must forward its transaction option to Lead.create');

    let findOptions;
    db.Lead.findOne = async (options) => { findOptions = options; return null; };
    await leadService.getOpenLeadForContactAndFacebookPage(99, 1, marker);
    assert.equal(findOptions.transaction, marker, 'getOpenLeadForContactAndFacebookPage must forward the transaction to Lead.findOne');
  } finally {
    db.Lead.create = originalCreate;
    db.Lead.findOne = originalFindOne;
    db.LeadStatus.findOne = originalStatusFindOne;
    db.LeadSource.findOne = originalSourceFindOne;
  }
});

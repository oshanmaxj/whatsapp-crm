const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sequelize, WhatsAppAccount, WhatsAppTemplate, Campaign, Flow, Conversation
} = require('../src/models');
const service = require('../src/services/whatsappAccount.service');

const originals = {
  findOne: WhatsAppAccount.findOne,
  findAll: WhatsAppAccount.findAll,
  templateFindAll: WhatsAppTemplate.findAll,
  campaignFindAll: Campaign.findAll,
  flowFindAll: Flow.findAll,
  conversationFindAll: Conversation.findAll
};

test.afterEach(() => {
  WhatsAppAccount.findOne = originals.findOne;
  WhatsAppAccount.findAll = originals.findAll;
  WhatsAppTemplate.findAll = originals.templateFindAll;
  Campaign.findAll = originals.campaignFindAll;
  Flow.findAll = originals.flowFindAll;
  Conversation.findAll = originals.conversationFindAll;
});

function accountRow(overrides = {}) {
  const row = {
    id: 1, name: 'Account', status: 'active', isDefault: true,
    accessTokenEncrypted: 'enc:x', appSecretEncrypted: null, webhookVerifyToken: null,
    ...overrides
  };
  row.toJSON = () => ({ ...row });
  return row;
}

test('list() batches statistics into one grouped query per model, independent of account count', async () => {
  const rows = [accountRow({ id: 1, name: 'A' }), accountRow({ id: 2, name: 'B' }), accountRow({ id: 3, name: 'C' })];
  WhatsAppAccount.findOne = async () => rows[0];
  WhatsAppAccount.findAll = async () => rows;

  const callCounts = { template: 0, campaign: 0, flow: 0, conversation: 0 };
  WhatsAppTemplate.findAll = async (opts) => {
    callCounts.template += 1;
    assert.deepEqual(opts.group, ['whatsappAccountId']);
    return [{ whatsappAccountId: 1, count: '4' }, { whatsappAccountId: 2, count: '0' }];
  };
  Campaign.findAll = async () => {
    callCounts.campaign += 1;
    return [{ whatsappAccountId: 2, count: '2' }];
  };
  Flow.findAll = async () => {
    callCounts.flow += 1;
    return [{ whatsappAccountId: 3, count: '1' }];
  };
  Conversation.findAll = async () => {
    callCounts.conversation += 1;
    return [{ whatsappAccountId: 1, count: '9' }, { whatsappAccountId: 3, count: '5' }];
  };

  const result = await service.list({});

  // Exactly one grouped query per model, regardless of how many accounts exist.
  assert.equal(callCounts.template, 1);
  assert.equal(callCounts.campaign, 1);
  assert.equal(callCounts.flow, 1);
  assert.equal(callCounts.conversation, 1);

  assert.equal(result.length, 3);
  const byId = new Map(result.map((r) => [r.id, r.statistics]));
  assert.deepEqual(byId.get(1), { templates: 4, campaigns: 0, flows: 0, conversations: 9 });
  assert.deepEqual(byId.get(2), { templates: 0, campaigns: 2, flows: 0, conversations: 0 });
  assert.deepEqual(byId.get(3), { templates: 0, campaigns: 0, flows: 1, conversations: 5 });
});

test('list() skips the grouped queries entirely when there are no accounts', async () => {
  WhatsAppAccount.findOne = async () => accountRow();
  WhatsAppAccount.findAll = async () => [];
  let called = false;
  WhatsAppTemplate.findAll = async () => { called = true; return []; };
  Campaign.findAll = async () => { called = true; return []; };
  Flow.findAll = async () => { called = true; return []; };
  Conversation.findAll = async () => { called = true; return []; };

  const result = await service.list({});
  assert.deepEqual(result, []);
  assert.equal(called, false);
});

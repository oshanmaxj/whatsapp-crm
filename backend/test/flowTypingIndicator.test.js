const test = require('node:test');
const assert = require('node:assert/strict');
const flowService = require('../src/services/flow.service');
const whatsappService = require('../src/services/whatsapp.service');
const typingService = require('../src/services/whatsappTypingIndicator.service');
const messagingWindow = require('../src/services/messagingWindow.service');
const outboundHistory = require('../src/services/outboundHistory.service');

const context = {
  flowId: 5, flowRunId: 6, conversationId: 7, whatsappAccountId: 9,
  whatsappMessageId: 'wamid.trigger', contact: { phone: '94770000000' }
};

test('flow sends typing before one outbound message and continues when typing is skipped', async () => {
  const originals = {
    typing: typingService.sendWhatsAppTypingIndicator,
    send: whatsappService.sendTextMessage,
    authorize: messagingWindow.authorizeSessionMessage,
    record: outboundHistory.record,
    enabled: process.env.FLOW_TYPING_INDICATOR_ENABLED,
    delay: process.env.FLOW_TYPING_DELAY_MS
  };
  const order = [];
  let typingResult = { status: 'sent' };
  typingService.sendWhatsAppTypingIndicator = async payload => { order.push(['typing', payload]); return typingResult; };
  whatsappService.sendTextMessage = async payload => { order.push(['message', payload]); return { id: 'wamid.outbound' }; };
  messagingWindow.authorizeSessionMessage = async () => ({ allowed: true });
  outboundHistory.record = async () => {};
  process.env.FLOW_TYPING_INDICATOR_ENABLED = 'true';
  process.env.FLOW_TYPING_DELAY_MS = '0';
  try {
    await flowService.executeMessageNode({ nodeKey: 'text', nodeType: 'text_message', label: 'Hello' }, { message: 'Hello' }, context, true);
    assert.deepEqual(order.map(item => item[0]), ['typing', 'message']);
    assert.equal(order[0][1].inboundWhatsappMessageId, 'wamid.trigger');
    assert.equal(order[0][1].whatsappAccountId, 9);

    order.length = 0;
    typingResult = { status: 'failed' };
    await flowService.executeMessageNode({ nodeKey: 'text-2', nodeType: 'text_message', label: 'Again' }, { message: 'Again' }, context, true);
    assert.deepEqual(order.map(item => item[0]), ['typing', 'message']);
    assert.equal(order.filter(item => item[0] === 'message').length, 1);
  } finally {
    typingService.sendWhatsAppTypingIndicator = originals.typing;
    whatsappService.sendTextMessage = originals.send;
    messagingWindow.authorizeSessionMessage = originals.authorize;
    outboundHistory.record = originals.record;
    if (originals.enabled === undefined) delete process.env.FLOW_TYPING_INDICATOR_ENABLED; else process.env.FLOW_TYPING_INDICATOR_ENABLED = originals.enabled;
    if (originals.delay === undefined) delete process.env.FLOW_TYPING_DELAY_MS; else process.env.FLOW_TYPING_DELAY_MS = originals.delay;
  }
});

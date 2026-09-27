const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planMessengerListMessage, MAX_QUICK_REPLIES, MAX_CAROUSEL_ELEMENTS, MAX_BUTTON_TEMPLATE_OPTIONS
} = require('../src/services/flowListMessageMessenger.service');

function sectionOf(rows) {
  return [{ title: 'Options', rows }];
}

test('a small (<=3), description-free list picks Button Template', () => {
  const plan = planMessengerListMessage({
    sections: sectionOf([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]),
    flowId: 1, nodeKey: 'n1'
  });
  assert.equal(plan.format, 'button_template');
  assert.equal(plan.options.length, 2);
});

test('a description-free list of 4-13 options picks Quick Replies and preserves every option', () => {
  const rows = Array.from({ length: MAX_QUICK_REPLIES }, (_, i) => ({ id: `o${i}`, title: `Option ${i}` }));
  const plan = planMessengerListMessage({ sections: sectionOf(rows), flowId: 1, nodeKey: 'n1' });
  assert.equal(plan.format, 'quick_replies');
  assert.equal(plan.options.length, MAX_QUICK_REPLIES);
});

test('more than 13 description-free options fails with a clear, classified error (no pagination-by-truncation)', () => {
  const rows = Array.from({ length: MAX_QUICK_REPLIES + 1 }, (_, i) => ({ id: `o${i}`, title: `Option ${i}` }));
  assert.throws(
    () => planMessengerListMessage({ sections: sectionOf(rows), flowId: 1, nodeKey: 'n1' }),
    (error) => error.code === 'FACEBOOK_LIST_MESSAGE_UNCONVERTIBLE' && /13/.test(error.message)
  );
});

test('any option with a description picks Generic Template and preserves the description', () => {
  const plan = planMessengerListMessage({
    sections: sectionOf([
      { id: 'a', title: 'Course A', description: 'A great course' },
      { id: 'b', title: 'Course B' }
    ]),
    flowId: 1, nodeKey: 'n1'
  });
  assert.equal(plan.format, 'generic_template');
  assert.equal(plan.options.find((o) => o.id === 'a').description, 'A great course');
  assert.equal(plan.options.find((o) => o.id === 'b').description, null);
});

test('a title too long for Quick Reply/Button Template (>20 chars) upgrades to Generic Template instead of truncating', () => {
  const longTitle = 'This title is definitely longer than twenty characters';
  assert.ok(longTitle.length > 20 && longTitle.length <= 80);
  const plan = planMessengerListMessage({
    sections: sectionOf([{ id: 'a', title: longTitle }, { id: 'b', title: 'Short' }]),
    flowId: 1, nodeKey: 'n1'
  });
  assert.equal(plan.format, 'generic_template');
  assert.equal(plan.options.find((o) => o.id === 'a').title, longTitle, 'title must not be truncated');
});

test('a title over 80 characters cannot be represented by any format and fails with a clear error', () => {
  const tooLong = 'x'.repeat(81);
  assert.throws(
    () => planMessengerListMessage({ sections: sectionOf([{ id: 'a', title: tooLong }]), flowId: 1, nodeKey: 'n1' }),
    (error) => error.code === 'FACEBOOK_LIST_MESSAGE_UNCONVERTIBLE' && /80/.test(error.message)
  );
});

test('more than 10 options with descriptions cannot fit the carousel and fail with a clear error', () => {
  const rows = Array.from({ length: MAX_CAROUSEL_ELEMENTS + 1 }, (_, i) => ({ id: `o${i}`, title: `Option ${i}`, description: 'x' }));
  assert.throws(
    () => planMessengerListMessage({ sections: sectionOf(rows), flowId: 1, nodeKey: 'n1' }),
    (error) => error.code === 'FACEBOOK_LIST_MESSAGE_UNCONVERTIBLE' && /10/.test(error.message)
  );
});

test('multiple sections are flattened in order and every option is preserved (section titles are not part of any option)', () => {
  const plan = planMessengerListMessage({
    sections: [
      { title: 'Popular', rows: [{ id: 'p1', title: 'Popular 1' }] },
      { title: 'New', rows: [{ id: 'n1row', title: 'New 1' }] }
    ],
    flowId: 1, nodeKey: 'n1'
  });
  assert.equal(plan.options.length, 2);
  assert.deepEqual(plan.options.map((o) => o.id), ['p1', 'n1row']);
});

test('option identifiers are preserved inside the encoded, decodable payload', () => {
  const plan = planMessengerListMessage({
    sections: sectionOf([{ id: 'row_7', title: 'Seven' }]),
    flowId: 99, nodeKey: 'nodeKeyABC'
  });
  assert.equal(plan.options[0].payload, 'flowbtn:99:nodeKeyABC:row_7');
});

test('an option missing a title fails clearly instead of being silently dropped', () => {
  assert.throws(
    () => planMessengerListMessage({ sections: sectionOf([{ id: 'a', title: '' }]), flowId: 1, nodeKey: 'n1' }),
    (error) => error.code === 'FACEBOOK_LIST_MESSAGE_UNCONVERTIBLE'
  );
});

test('a list with no options at all fails clearly', () => {
  assert.throws(
    () => planMessengerListMessage({ sections: [], flowId: 1, nodeKey: 'n1' }),
    (error) => error.code === 'FACEBOOK_LIST_MESSAGE_UNCONVERTIBLE'
  );
});

test('exactly at the Button Template boundary (3 options) still picks Button Template, not Quick Replies', () => {
  const rows = Array.from({ length: MAX_BUTTON_TEMPLATE_OPTIONS }, (_, i) => ({ id: `o${i}`, title: `Option ${i}` }));
  const plan = planMessengerListMessage({ sections: sectionOf(rows), flowId: 1, nodeKey: 'n1' });
  assert.equal(plan.format, 'button_template');
});

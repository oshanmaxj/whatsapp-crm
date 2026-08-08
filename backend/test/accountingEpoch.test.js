const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const models = require('../src/models');
const audit = require('../src/services/audit.service');
const epochService = require('../src/services/accountingEpoch.service');
const accounting = require('../src/services/accounting.service');

function opValue(object) { const symbol = Object.getOwnPropertySymbols(object || {})[0]; return symbol ? object[symbol] : undefined; }

test('dashboard totals, recent transactions, lists and reports share the current epoch predicate', async () => {
  const originals = { epoch: models.AccountingReportingEpoch.findOne, findAll: models.AccountingTransaction.findAll };
  const started = new Date('2026-08-08T05:00:00.000Z');
  const whereSeen = [];
  models.AccountingReportingEpoch.findOne = async () => ({ id: 1, trackingStartedAt: started });
  models.AccountingTransaction.findAll = async options => {
    whereSeen.push(options.where);
    if (options.limit) return [];
    if (options.include) return [];
    return [{ type: 'income', total: '0' }, { type: 'expense', total: '0' }];
  };
  try {
    const actor = { id: 1, isSystemAdmin: true };
    const summary = await accounting.summary({}, actor);
    const report = await accounting.reports({}, actor);
    assert.equal(summary.totalIncome, 0);
    assert.equal(summary.totalExpenses, 0);
    assert.equal(report.totalIncome, 0);
    assert.ok(whereSeen.length >= 4);
    assert.ok(whereSeen.every(where => !where?.sourceEventAt || opValue(where.sourceEventAt)?.getTime() === started.getTime()));
  } finally { models.AccountingReportingEpoch.findOne = originals.epoch; models.AccountingTransaction.findAll = originals.findAll; }
});

test('historical access and reset are system-admin only', async () => {
  await assert.rejects(epochService.scopeWhere('historical', { id: 2, isSystemAdmin: false }), error => error.status === 403);
  await assert.rejects(epochService.reset({ trackingStartedAt: new Date().toISOString(), reason: 'test', confirmation: 'RESET ACCOUNTING' }, { id: 2, isSystemAdmin: false }), error => error.status === 403);
});

test('reset uses one transaction, advisory lock and required immutable audit event', async () => {
  const originals = {
    transaction: models.sequelize.transaction, query: models.sequelize.query,
    findOne: models.AccountingReportingEpoch.findOne, create: models.AccountingReportingEpoch.create, record: audit.record
  };
  const calls = [];
  const tx = { LOCK: { UPDATE: 'UPDATE' } };
  models.sequelize.transaction = async callback => callback(tx);
  models.sequelize.query = async (sql, options) => { calls.push({ sql, options }); return []; };
  models.AccountingReportingEpoch.findOne = async () => ({ trackingStartedAt: new Date('2025-01-01T00:00:00Z') });
  models.AccountingReportingEpoch.create = async values => ({ id: 12, ...values });
  audit.record = async values => { calls.push({ audit: values }); return { id: 44 }; };
  const maintenanceFlag = process.env.ACCOUNTING_RESET_MAINTENANCE_ENABLED;
  process.env.ACCOUNTING_RESET_MAINTENANCE_ENABLED = 'true';
  try {
    const epoch = await epochService.reset({ trackingStartedAt: '2026-08-07T04:00:00Z', reason: 'Administrator reset', confirmation: 'RESET ACCOUNTING' }, { id: 9, isSystemAdmin: true, permissions: ['accounting.reset_maintenance'] });
    assert.equal(epoch.id, 12);
    assert.match(calls[0].sql, /pg_advisory_xact_lock/);
    assert.equal(calls.find(item => item.audit).audit.required, true);
    assert.equal(calls.find(item => item.audit).audit.transaction, tx);
  } finally { if (maintenanceFlag === undefined) delete process.env.ACCOUNTING_RESET_MAINTENANCE_ENABLED; else process.env.ACCOUNTING_RESET_MAINTENANCE_ENABLED = maintenanceFlag; Object.assign(models.sequelize, { transaction: originals.transaction, query: originals.query }); models.AccountingReportingEpoch.findOne = originals.findOne; models.AccountingReportingEpoch.create = originals.create; audit.record = originals.record; }
});

test('migration archives by epoch without destructive SQL and preserves stable source identities', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/059_accounting_reporting_epoch.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:DELETE|TRUNCATE)\b/i);
  assert.match(source, /source_event_at/);
  assert.match(source, /accounting_transactions_source_identity_unique/);
  assert.match(source, /fee_installments/);
  assert.match(source, /payment_receipts/);
  assert.match(source, /commission_accounting_links/);
});

test('all automated accounting creation paths persist stable source identity and business-event time', () => {
  for (const file of ['education.service.js', 'paymentSlip.service.js', 'commissionAccountingSync.service.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../src/services', file), 'utf8');
    assert.match(source, /sourceEventAt/);
    assert.match(source, /sourceType/);
    assert.match(source, /sourceId/);
  }
});

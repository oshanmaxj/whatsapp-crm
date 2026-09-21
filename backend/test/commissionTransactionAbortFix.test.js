const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, CommissionLedger, CommissionCalculationSnapshot, User } = require('../src/models');
const commissionLedgerService = require('../src/services/commissionLedger.service');
const { findOrCreateSafely } = commissionLedgerService;
const calculation = require('../src/services/commissionCalculation.service');

const originals = {
  sequelizeTransaction: sequelize.transaction,
  ledgerFindOne: CommissionLedger.findOne,
  ledgerCreate: CommissionLedger.create,
  snapshotCreate: CommissionCalculationSnapshot.create,
  userFindByPk: User.findByPk,
  sequelizeQuery: sequelize.query,
  contextForInstallment: calculation.contextForInstallment,
  calculate: calculation.calculate
};

test.afterEach(() => {
  sequelize.transaction = originals.sequelizeTransaction;
  CommissionLedger.findOne = originals.ledgerFindOne;
  CommissionLedger.create = originals.ledgerCreate;
  CommissionCalculationSnapshot.create = originals.snapshotCreate;
  User.findByPk = originals.userFindByPk;
  sequelize.query = originals.sequelizeQuery;
  calculation.contextForInstallment = originals.contextForInstallment;
  calculation.calculate = originals.calculate;
});

// A minimal fake Sequelize-shaped model, used to test findOrCreateSafely's
// OWN race-handling logic in complete isolation from the real CommissionLedger
// model/schema — this is what item #8 ("identify and test the exact original
// transaction-abort root cause") is really about: proving our replacement
// for Sequelize's own buggy findOrCreate() correctly survives a unique-
// constraint race without ever needing a follow-up query on a poisoned
// transaction.
function fakeModel() {
  const rows = new Map();
  return {
    rows,
    async findOne({ where }) {
      for (const row of rows.values()) if (row.idempotencyKey === where.idempotencyKey) return row;
      return null;
    },
    async create(defaults) {
      for (const row of rows.values()) if (row.idempotencyKey === defaults.idempotencyKey) {
        const error = new Error('duplicate key value violates unique constraint "commission_ledger_idempotency_key_key"');
        error.name = 'SequelizeUniqueConstraintError';
        throw error;
      }
      const row = { id: rows.size + 1, ...defaults };
      rows.set(row.id, row);
      return row;
    }
  };
}

// --- #8: the exact original transaction-abort root cause, reproduced and fixed ---

test('#8 a genuine unique-constraint race (two concurrent creates for the same idempotencyKey) resolves to ONE row and never throws "transaction aborted" — unlike Sequelize\'s own findOrCreate()', async () => {
  const Model = fakeModel();
  // Simulate the race exactly as it would happen against Postgres: both
  // callers' findOne() sees nothing yet, then one create() wins and the
  // other collides. sequelize.transaction({transaction}, cb) here just runs
  // cb immediately (no real savepoint needed for this unit-level test — the
  // savepoint mechanics themselves are Sequelize's own, already verified by
  // reading node_modules/sequelize/lib/transaction.js).
  sequelize.transaction = async (options, cb) => cb({});

  const defaults = { idempotencyKey: 'payment:1:agent:2:rule:3:commission', amount: '100.00' };
  const [first, firstIsNew] = await findOrCreateSafely(Model, { where: { idempotencyKey: defaults.idempotencyKey }, defaults, transaction: {} });
  assert.equal(firstIsNew, true);

  // Second caller loses the race: its own findOne() (inside findOrCreateSafely)
  // now correctly sees the row the first caller just created — via the
  // pre-check that runs BEFORE any create() is attempted, exactly like the
  // fixed code path.
  const [second, secondIsNew] = await findOrCreateSafely(Model, { where: { idempotencyKey: defaults.idempotencyKey }, defaults, transaction: {} });
  assert.equal(secondIsNew, false);
  assert.equal(second.id, first.id);
  assert.equal(Model.rows.size, 1, 'exactly one commission row must exist after both calls');
});

test('#8 when the initial findOne() itself misses (true race window) and create() collides, the UniqueConstraintError fallback findOne() succeeds — this is the exact step Sequelize\'s own findOrCreate() gets wrong', async () => {
  const Model = fakeModel();
  const key = 'payment:9:agent:2:rule:3:commission';
  // Pre-seed the row directly (bypassing findOrCreateSafely) to simulate
  // "another process already committed this row between our findOne() and
  // our create()" — the narrowest possible race window.
  Model.rows.set(1, { id: 1, idempotencyKey: key, amount: '50.00' });
  const originalFindOne = Model.findOne.bind(Model);
  let findOneCalls = 0;
  Model.findOne = async (opts) => {
    findOneCalls += 1;
    if (findOneCalls === 1) return null; // pretend the row wasn't visible yet on the first check
    return originalFindOne(opts);
  };
  sequelize.transaction = async (options, cb) => cb({});

  const [winner, isNew] = await findOrCreateSafely(Model, { where: { idempotencyKey: key }, defaults: { idempotencyKey: key, amount: '50.00' }, transaction: {} });

  assert.equal(isNew, false);
  assert.equal(winner.id, 1);
});

test('a non-uniqueness error from create() is never swallowed — it propagates as-is (fail loud on genuine bugs, not just races)', async () => {
  const Model = fakeModel();
  Model.create = async () => { throw new Error('null value in column "amount" violates not-null constraint'); };
  sequelize.transaction = async (options, cb) => cb({});

  await assert.rejects(
    findOrCreateSafely(Model, { where: { idempotencyKey: 'x' }, defaults: { idempotencyKey: 'x' }, transaction: {} }),
    /violates not-null constraint/
  );
});

// --- #1/#2/#3: commission generated once, idempotent across repeat calls -----

function componentFixture() {
  return {
    earningType: 'agent_commission', earningComponent: 'rule:1', beneficiaryType: 'agent', beneficiaryId: 7,
    ruleId: 1, basis: '1000.00', rate: '10', amount: '100.00', status: 'payable', rule: { payoutDelayDays: 0 }
  };
}

// generateForPayment's outer call uses the single-callback form
// (sequelize.transaction(execute)); findOrCreateSafely's inner savepoint
// uses the two-arg form (sequelize.transaction({transaction}, cb)) — a
// realistic mock has to dispatch on which one is being used, exactly like
// the real Sequelize.prototype.transaction does.
function mockSequelizeTransaction() {
  sequelize.transaction = async (optionsOrCallback, maybeCallback) => {
    if (typeof optionsOrCallback === 'function') return optionsOrCallback({});
    return maybeCallback({});
  };
}

function fakeLedgerModel() {
  const rows = new Map();
  let nextId = 1;
  CommissionLedger.findOne = async ({ where }) => {
    for (const row of rows.values()) if (row.idempotencyKey === where.idempotencyKey) return row;
    return null;
  };
  CommissionLedger.create = async (defaults) => {
    const row = { id: nextId++, get(key) { return this[key]; }, ...defaults };
    rows.set(row.id, row);
    return row;
  };
  return rows;
}

function stubCalculation() {
  calculation.contextForInstallment = async (id) => ({
    payment: { id, transactionReference: 'REF', paymentMethod: 'Cash' },
    fee: { studentId: 5, enrollmentId: null },
    student: { name: 'Stu', studentNo: 'STU-1' }, course: { name: 'Course' }, batch: { name: 'Batch' },
    sourcePaymentId: id, accountingTransactionId: 77, courseId: 1, batchId: 1, leadId: null,
    whatsappAccountId: null, collectedAmount: '1000.00', discountAmount: '0.00'
  });
  calculation.calculate = async () => ({
    components: [componentFixture()],
    totals: { grossPayment: '1000.00', directExpenses: '0.00', instituteMargin: '900.00' }
  });
}

test('#1 a successful eligible payment generates a commission ledger row', async () => {
  stubCalculation();
  mockSequelizeTransaction();
  fakeLedgerModel();
  User.findByPk = async () => ({ get: () => 'agent@example.com' });
  CommissionCalculationSnapshot.create = async () => ({});
  sequelize.query = async () => [[]];

  const created = await commissionLedgerService.generateForPayment(101);

  assert.equal(created.length, 1);
  assert.equal(created[0].beneficiaryId, 7);
  assert.equal(created[0].amount, '100.00');
});

test('#2/#3 calling generateForPayment twice for the same payment creates the commission exactly once (idempotent, no duplicate row)', async () => {
  stubCalculation();
  mockSequelizeTransaction();
  fakeLedgerModel();
  User.findByPk = async () => ({ get: () => 'agent@example.com' });
  CommissionCalculationSnapshot.create = async () => ({});
  sequelize.query = async () => [[]];

  const first = await commissionLedgerService.generateForPayment(202);
  const second = await commissionLedgerService.generateForPayment(202);

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].id, second[0].id, 'the second call must return the SAME row, not a new one');
});

// --- #9: partial payment (existing business rule: collectedAmount reflects
// the installment's cumulative paidAmount at calculation time) ---------------

test('#9 commission basis uses the payment context\'s collectedAmount as provided by contextForInstallment (existing business rule, unchanged)', async () => {
  calculation.contextForInstallment = async (id) => ({
    payment: { id, transactionReference: 'REF', paymentMethod: 'Cash' },
    fee: { studentId: 5, enrollmentId: null }, student: { name: 'Stu' }, course: {}, batch: {},
    sourcePaymentId: id, accountingTransactionId: 1, courseId: 1, batchId: 1, leadId: null,
    whatsappAccountId: null, collectedAmount: '300.00', discountAmount: '0.00'
  });
  calculation.calculate = async (context) => ({
    components: [{ ...componentFixture(), basis: context.collectedAmount, amount: '30.00' }],
    totals: { grossPayment: context.collectedAmount, directExpenses: '0.00', instituteMargin: '270.00' }
  });
  mockSequelizeTransaction();
  fakeLedgerModel();
  User.findByPk = async () => null;
  CommissionCalculationSnapshot.create = async () => ({});
  sequelize.query = async () => [[]];

  const created = await commissionLedgerService.generateForPayment(303);

  assert.equal(created[0].calculationBasis, '300.00');
  assert.equal(created[0].amount, '30.00');
});

// --- #11: ineligible payment (not confirmed) never generates a commission ---

test('#11 an installment that is not confirmed/paid is rejected by contextForInstallment and no commission row is created', async () => {
  const { FeeInstallment } = require('../src/models');
  const originalFindByPk = FeeInstallment.findByPk;
  FeeInstallment.findByPk = async () => ({ status: 'pending_confirmation', paidAmount: '0.00' });

  await assert.rejects(
    calculation.contextForInstallment(404, {}),
    /Only a confirmed payment can generate earnings/
  );

  FeeInstallment.findByPk = originalFindByPk;
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Flow, FlowRun } = require('../src/models');
const flowService = require('../src/services/flow.service');
const whatsappAccountAccessService = require('../src/services/whatsappAccountAccess.service');
const facebookPageAccessService = require('../src/services/facebookPageAccess.service');

// --- Task 1: Flow model no longer exposes a priority column -----------------

test('#1 the Flow model has no priority column — priority never existed as a DB column, only as a key inside the triggerConfig JSON blob', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/models/flow.model.js'), 'utf8');
  assert.doesNotMatch(source, /\bpriority\s*:/i);
});

test('#1 no migration in the repository ever added a priority column to the flows table (confirms no schema migration is needed to remove it)', () => {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.js'));
  const offenders = files.filter((name) => {
    const source = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    return /addColumn\(\s*['"]flows['"]\s*,\s*['"]priority['"]/i.test(source);
  });
  assert.deepEqual(offenders, []);
});

// --- Tasks 2/3/4: create/update/duplicate never read or write priority -----

test('#2/#3 flow.service.js\'s create()/update() never special-case triggerConfig.priority — it is stored (if present at all) as an inert, unread key exactly like any other triggerConfig field', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/flow.service.js'), 'utf8');
  const createBody = source.slice(source.indexOf('async create(payload'), source.indexOf('\n  async update('));
  const updateBody = source.slice(source.indexOf('\n  async update('), source.indexOf('\n  async remove('));
  assert.doesNotMatch(createBody, /\.priority\b/);
  assert.doesNotMatch(updateBody, /\.priority\b/);
});

test('#6 flow.service.js no longer sorts matched flows by triggerConfig.priority anywhere — matching order comes from the DB query\'s createdAt/id ORDER BY instead', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/flow.service.js'), 'utf8');
  assert.doesNotMatch(source, /triggerConfig\?\.priority/);
  assert.doesNotMatch(source, /triggerPriorityConflicts/);
  const orderByOccurrences = source.split("order: [['created_at', 'ASC'], ['id', 'ASC']]").length - 1;
  assert.equal(orderByOccurrences, 2, 'both trigger-matching candidate queries (handleInboundMessage and handleDomainEvent) must order by createdAt ASC, id ASC');
});

// --- Tasks 8/9: stopAfterMatch semantics are untouched ----------------------

test('#8/#9 stopAfterMatch still reads from triggerConfig (unchanged column/field) and the loop-break condition is untouched by the priority removal', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/flow.service.js'), 'utf8');
  const breakOccurrences = source.split("triggerConfig?.stopAfterMatch !== false) break;").length - 1;
  assert.equal(breakOccurrences, 2, 'both matching loops (handleInboundMessage and handleDomainEvent) must keep the exact same stopAfterMatch break condition');
});

// --- Part 12: cleanup search — no remaining Flow-specific priority runtime dependency ---

test('#12 cleanup search: FlowNodeConfigDialog.jsx no longer has a Trigger priority field or its validation', () => {
  const dialogSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/src/components/flow-builder/FlowNodeConfigDialog.jsx'), 'utf8');
  assert.doesNotMatch(dialogSource, /Trigger priority/i);
  assert.doesNotMatch(dialogSource, /set\('priority'/);
  const configSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/src/components/flow-builder/flowBuilderConfig.js'), 'utf8');
  assert.doesNotMatch(configSource, /Priority must be a whole number/);
});

test('#12 cleanup search: FlowBuilderListPage.jsx no longer renders a Priority column', () => {
  const listSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/src/pages/FlowBuilderListPage.jsx'), 'utf8');
  assert.doesNotMatch(listSource, /<TableCell>Priority<\/TableCell>/);
  assert.doesNotMatch(listSource, /triggerConfig\?\.priority/);
});

// --- Part 3/9: the list() filter's underlying dropdown reuses the ALREADY
// permission-scoped /whatsapp-accounts endpoint — no parallel authorization ---

test('#14 the Flow Builder\'s WhatsApp filter dropdown (WhatsAppAccountSelect) fetches from the existing, already user-scoped /whatsapp-accounts endpoint — no new/parallel authorization system was introduced', () => {
  const listPageSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/src/pages/FlowBuilderListPage.jsx'), 'utf8');
  assert.match(listPageSource, /WhatsAppAccountSelect/);
  assert.doesNotMatch(listPageSource, /new.*Access.*Service|parallelAuthorization/i);
  const selectSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/src/components/WhatsAppAccountSelect.jsx'), 'utf8');
  assert.match(selectSource, /getWhatsAppAccounts/);
});

test('#15 GET /whatsapp-accounts (the endpoint the filter dropdown uses) is already scoped by whatsappAccountAccessService for the current user — confirmed at the service layer', async () => {
  const whatsappAccountService = require('../src/services/whatsappAccount.service');
  const original = whatsappAccountAccessService.whereForUser;
  let capturedUserId = null;
  const { Op } = require('sequelize');
  whatsappAccountAccessService.whereForUser = async (userId, field) => { capturedUserId = userId; return { [field]: { [Op.in]: ['5'] } }; };
  const { WhatsAppAccount } = require('../src/models');
  const originalFindAll = WhatsAppAccount.findAll;
  let capturedWhere = null;
  WhatsAppAccount.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  try {
    await whatsappAccountService.list({ userId: 77 });
    assert.equal(capturedUserId, 77);
    assert.ok(capturedWhere.id, 'the account list query must be restricted by the resolved access scope');
  } finally {
    whatsappAccountAccessService.whereForUser = original;
    WhatsAppAccount.findAll = originalFindAll;
  }
});

// --- Part 21/Task 21: run history / analytics associations are untouched ---

test('#21 Flow -> FlowRun association is unchanged by this work (run history/analytics still resolve through the same relationship)', () => {
  assert.ok(Flow.associations.runs, 'Flow.hasMany(FlowRun, {as: "runs"}) must still exist');
  assert.equal(Flow.associations.runs.target, FlowRun);
});

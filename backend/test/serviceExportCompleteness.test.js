const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// This file exists specifically to catch the class of mistake behind the
// fa4f0d8/f330daf incidents: a controller or route calling a service method
// that was never actually committed (usually because a blanket `git add` on
// a file swept in an intended edit's controller/route half but not its
// service-layer half, or vice versa). It loads the REAL exported singletons
// — no stubbing, no mocking the method into existence — so a genuinely
// missing method fails here exactly the way it would fail in production.

function methodNamesCalledOn(objectName, sourceFiles) {
  const pattern = new RegExp(`${objectName}\\.([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(`, 'g');
  const names = new Set();
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = pattern.exec(source))) names.add(match[1]);
  }
  return names;
}

function allJsFilesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return allJsFilesUnder(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const backendRoot = path.join(__dirname, '..');
const controllerFiles = allJsFilesUnder(path.join(backendRoot, 'src/controllers'));
const routeFiles = allJsFilesUnder(path.join(backendRoot, 'src/routes'));
const serviceFiles = allJsFilesUnder(path.join(backendRoot, 'src/services'));

// --- Task 8: the exact regression this incident needs, asserted directly ---

test('the REAL exported inboxService (no mocking) has getMediaByWhatsappMediaId as a callable function', () => {
  const inboxService = require('../src/services/inbox.service');
  assert.equal(typeof inboxService.getMediaByWhatsappMediaId, 'function');
  assert.equal(typeof inboxService.getMedia, 'function');
  assert.equal(typeof inboxService.authorizeMediaAccess, 'function');
});

test('media.controller.js\'s downloadByWhatsappMediaId calls inboxService.getMediaByWhatsappMediaId with the exact same casing the service defines', () => {
  const controllerSource = fs.readFileSync(path.join(backendRoot, 'src/controllers/media.controller.js'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(backendRoot, 'src/services/inbox.service.js'), 'utf8');
  assert.match(controllerSource, /inboxService\.getMediaByWhatsappMediaId\(/);
  assert.match(serviceSource, /async getMediaByWhatsappMediaId\(/);
});

// --- General safety net: every controller/route method call against these
// services must resolve on the REAL exported singleton, not a test double.

test('every inboxService.<method>() call across controllers/routes exists on the real exported inboxService', () => {
  const inboxService = require('../src/services/inbox.service');
  const names = methodNamesCalledOn('inboxService', [...controllerFiles, ...routeFiles]);
  const missing = [...names].filter((name) => typeof inboxService[name] !== 'function');
  assert.deepEqual(missing, []);
});

test('every educationService.<method>() call across controllers/routes exists on the real exported educationService', () => {
  const educationService = require('../src/services/education.service');
  const names = methodNamesCalledOn('educationService', [...controllerFiles, ...routeFiles]);
  const missing = [...names].filter((name) => typeof educationService[name] !== 'function');
  assert.deepEqual(missing, []);
});

test('every paymentSlipService.<method>() call across controllers/routes/services exists on the real exported paymentSlipService', () => {
  const paymentSlipService = require('../src/services/paymentSlip.service');
  const names = methodNamesCalledOn('paymentSlipService', [...controllerFiles, ...routeFiles, ...serviceFiles]);
  const missing = [...names].filter((name) => typeof paymentSlipService[name] !== 'function');
  assert.deepEqual(missing, []);
});

test('every studentMessageAutomationService.<method>() call across services exists on the real exported singleton', () => {
  const studentMessageAutomationService = require('../src/services/studentMessageAutomation.service');
  const names = methodNamesCalledOn('studentMessageAutomationService', serviceFiles);
  const missing = [...names].filter((name) => typeof studentMessageAutomationService[name] !== 'function');
  assert.deepEqual(missing, []);
});

test('every mediaController.<method> bound in media.routes.js exists on the real exported controller', () => {
  const mediaController = require('../src/controllers/media.controller');
  const routeSource = fs.readFileSync(path.join(backendRoot, 'src/routes/media.routes.js'), 'utf8');
  const names = new Set();
  const pattern = /mediaController\.([a-zA-Z_][a-zA-Z0-9_]*)\.bind/g;
  let match;
  while ((match = pattern.exec(routeSource))) names.add(match[1]);
  assert.ok(names.size > 0, 'sanity check: the route file must actually reference mediaController methods');
  const missing = [...names].filter((name) => typeof mediaController[name] !== 'function');
  assert.deepEqual(missing, []);
});

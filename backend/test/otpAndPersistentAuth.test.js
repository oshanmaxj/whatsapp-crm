const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const models = require('../src/models');
const authService = require('../src/services/auth.service');
const studentPortal = require('../src/services/studentPortal.service');
const whatsappService = require('../src/services/whatsapp.service');
const userService = require('../src/services/user.service');
const { normalizeSriLankanPhone } = require('../src/utils/phone');
const { accessTokenSecret } = require('../src/config/jwt');

function row(values) {
  return { ...values, async update(changes) { Object.assign(this, changes); return this; }, async increment(field) { this[field] = Number(this[field] || 0) + 1; } };
}

test('Sri Lankan mobile normalization accepts all supported formats', () => {
  for (const value of ['0775652000', '775652000', '+94775652000', '94775652000']) {
    assert.equal(normalizeSriLankanPhone(value), '94775652000');
  }
});

test('OTP request sends the configured Meta authentication template without logging/storing plaintext OTP', async () => {
  const originals = {
    scope: models.Student.scope, findAll: models.StudentPortalSession.findAll,
    update: models.StudentPortalSession.update, create: models.StudentPortalSession.create,
    runtime: whatsappService.getRuntimeConfig, send: whatsappService.sendTemplateMessage
  };
  const student = row({ id: 4, studentNo: 'STU-4', phone: '775652000', status: 'active' });
  let sent;
  const session = row({ id: 8, otpExpiresAt: new Date(Date.now() + 300000), createdAt: new Date(), otpAttempts: 0 });
  const env = { ...process.env };
  try {
    process.env.WHATSAPP_SEND_ENABLED = 'true'; process.env.WHATSAPP_OTP_TEMPLATE_NAME = 'student_login_otp';
    process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE = 'en_US';
    models.Student.scope = () => ({ findOne: async () => student });
    models.StudentPortalSession.findAll = async () => [];
    models.StudentPortalSession.update = async () => [0];
    models.StudentPortalSession.create = async (values) => { Object.assign(session, values); return session; };
    whatsappService.getRuntimeConfig = async () => ({ accessToken: 'configured', phoneNumberId: 'configured', apiVersion: 'v25.0' });
    whatsappService.sendTemplateMessage = async (payload) => { sent = payload; return { id: 'message-id' }; };
    const result = await studentPortal.login({ identifier: '0775652000', method: 'otp' }, { requestId: 'test-request' });
    assert.equal(sent.to, '94775652000');
    assert.equal(sent.templateName, 'student_login_otp');
    assert.equal(sent.language, 'en_US');
    assert.match(sent.components[0].parameters[0].text, /^\d{6}$/);
    assert.notEqual(session.otpHash, sent.components[0].parameters[0].text);
    assert.ok(await bcrypt.compare(sent.components[0].parameters[0].text, session.otpHash));
    assert.ok(result.challengeToken);
  } finally {
    process.env = env;
    models.Student.scope = originals.scope; models.StudentPortalSession.findAll = originals.findAll;
    models.StudentPortalSession.update = originals.update; models.StudentPortalSession.create = originals.create;
    whatsappService.getRuntimeConfig = originals.runtime; whatsappService.sendTemplateMessage = originals.send;
  }
});

test('OTP Meta failures retain actionable internal classifications', () => {
  assert.deepEqual(studentPortal.mapOtpSendFailure({ response: { status: 401, data: { error: { code: 190 } } } }).code, 'WHATSAPP_AUTHENTICATION_FAILED');
  assert.equal(studentPortal.mapOtpSendFailure({ response: { status: 429, data: { error: { code: 4 } } } }).status, 503);
  assert.equal(studentPortal.mapOtpSendFailure({ response: { status: 400, data: { error: { code: 132001 } } } }).code, 'WHATSAPP_META_REJECTED');
});

test('OTP resend cooldown and expiry are enforced', async () => {
  const originalFindAll = models.StudentPortalSession.findAll;
  const originalScope = models.Student.scope;
  const originalSessionFind = models.StudentPortalSession.findOne;
  const originalRuntime = whatsappService.getRuntimeConfig;
  const env = { ...process.env };
  try {
    process.env.WHATSAPP_SEND_ENABLED = 'true'; process.env.WHATSAPP_OTP_TEMPLATE_NAME = 'otp';
    models.Student.scope = () => ({ findOne: async () => row({ id: 1, phone: '0775652000', status: 'active' }) });
    whatsappService.getRuntimeConfig = async () => ({ accessToken: 'x', phoneNumberId: 'y', apiVersion: 'v25.0' });
    models.StudentPortalSession.findAll = async () => [{ createdAt: new Date() }];
    await assert.rejects(() => studentPortal.login({ identifier: '0775652000', method: 'otp' }), (error) => error.code === 'OTP_RATE_LIMITED' && error.status === 429);
    const expired = row({ id: 2, studentId: 1, otpHash: 'hash', otpExpiresAt: new Date(Date.now() - 1000), otpAttempts: 0 });
    models.StudentPortalSession.findOne = async () => expired;
    await assert.rejects(() => studentPortal.verifyOtp({ challengeToken: 'challenge', otp: '123456' }), (error) => error.code === 'OTP_EXPIRED');
    assert.ok(expired.revokedAt);
  } finally {
    process.env = env; models.Student.scope = originalScope; models.StudentPortalSession.findAll = originalFindAll;
    models.StudentPortalSession.findOne = originalSessionFind; whatsappService.getRuntimeConfig = originalRuntime;
  }
});

test('successful OTP verification marks the challenge used and issues a portal token', async () => {
  const hash = await bcrypt.hash('123456', 4);
  const session = row({ id: 3, studentId: 9, otpHash: hash, otpExpiresAt: new Date(Date.now() + 60000), otpAttempts: 0 });
  const originals = { find: models.StudentPortalSession.findOne, update: models.StudentPortalSession.update, student: models.Student.findByPk, findStudent: studentPortal.findStudent, issue: studentPortal.issueToken, payment: studentPortal.paymentAccess };
  try {
    models.StudentPortalSession.findOne = async () => session;
    models.StudentPortalSession.update = async () => [1];
    models.Student.findByPk = async () => ({ studentNo: 'STU-9' });
    studentPortal.findStudent = async () => row({ id: 9, name: 'Student', status: 'active', enrollments: [] });
    studentPortal.issueToken = async () => ({ token: 'portal-token' });
    studentPortal.paymentAccess = async () => ({ allowed: true, enrollments: [] });
    const result = await studentPortal.verifyOtp({ challengeToken: 'challenge', otp: '123456' });
    assert.equal(result.token, 'portal-token');
  } finally {
    models.StudentPortalSession.findOne = originals.find; models.StudentPortalSession.update = originals.update;
    models.Student.findByPk = originals.student; studentPortal.findStudent = originals.findStudent;
    studentPortal.issueToken = originals.issue; studentPortal.paymentAccess = originals.payment;
  }
});

test('expired access token can be replaced through a rotated persistent refresh session', async () => {
  const originals = { create: models.AuthSession.create, find: models.AuthSession.findByPk, user: models.User.findByPk, access: userService.getUserAccessPayload };
  const user = row({ id: 5, email: 'agent@example.com', status: 'active', isSystemAdmin: false });
  let session;
  try {
    userService.getUserAccessPayload = async () => ({ id: 5, roles: [], permissions: [] });
    models.AuthSession.create = async (values) => { session = row({ id: 12, ...values }); return session; };
    models.AuthSession.findByPk = async () => session;
    models.User.findByPk = async () => user;
    const issued = await authService.buildAuthResponse(user);
    const expiredAccess = jwt.sign({ id: 5 }, accessTokenSecret, { expiresIn: -1 });
    assert.throws(() => authService.verifyAccessToken(expiredAccess), /expired/i);
    const refreshed = await authService.refreshSession(issued.tokens.refreshToken);
    assert.ok(authService.verifyAccessToken(refreshed.tokens.accessToken));
    assert.notEqual(refreshed.tokens.refreshToken, issued.tokens.refreshToken);
  } finally {
    models.AuthSession.create = originals.create; models.AuthSession.findByPk = originals.find;
    models.User.findByPk = originals.user; userService.getUserAccessPayload = originals.access;
  }
});

test('revoked refresh sessions fail and explicit logout revokes the session', async () => {
  const originals = { create: models.AuthSession.create, find: models.AuthSession.findByPk, update: models.AuthSession.update, access: userService.getUserAccessPayload };
  const user = row({ id: 6, email: 'user@example.com', status: 'active', isSystemAdmin: false });
  let session;
  let revoked = false;
  try {
    userService.getUserAccessPayload = async () => ({ id: 6, roles: [], permissions: [] });
    models.AuthSession.create = async (values) => { session = row({ id: 14, ...values }); return session; };
    models.AuthSession.findByPk = async () => session;
    models.AuthSession.update = async () => { revoked = true; return [1]; };
    const issued = await authService.buildAuthResponse(user);
    session.revokedAt = new Date();
    await assert.rejects(() => authService.refreshSession(issued.tokens.refreshToken), (error) => error.code === 'AUTH_REFRESH_INVALID');
    session.revokedAt = null;
    await authService.logout(issued.tokens.refreshToken);
    assert.equal(revoked, true);
  } finally {
    models.AuthSession.create = originals.create; models.AuthSession.findByPk = originals.find;
    models.AuthSession.update = originals.update; userService.getUserAccessPayload = originals.access;
  }
});

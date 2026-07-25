const { Op } = require('sequelize');
const models = require('../models');
const compliance = require('./whatsappCompliance.service');
const whatsapp = require('./whatsapp.service');
const logger = require('../config/logger');
const whatsappAccountAccess = require('./whatsappAccountAccess.service');
const { REMINDER_SEQUENCE_STATUS, REMINDER_SEQUENCE_STATUSES, REMINDER_SEQUENCE_TRANSITIONS } = require('../constants/reminderSequenceStatus');

const ACTIVE = ['active', 'paused'];
const DELAY_UNITS = new Set(['minutes', 'hours', 'days']);
const delayMs = (step) => Number(step.delayValue) * ({ minutes: 60000, hours: 3600000, days: 86400000 }[step.delayUnit] || 60000);
const safeError = (error) => String(error?.message || 'Delivery failed').replace(/(bearer|api[_ -]?key|token)\s*[:=]?\s*\S+/ig, '$1 [redacted]').slice(0, 1000);
const optional = value => value === undefined || value === null || String(value).trim() === '' ? null : value;
const validationError = errors => Object.assign(new Error('Validation failed'), {
  status: 422, code: 'VALIDATION_FAILED', errors
});

function normalizeSequence(payload = {}) {
  const steps = Array.isArray(payload.steps) ? payload.steps.map((step = {}) => ({
    ...step,
    delayValue: Number(step.delayValue ?? step.sendAfter),
    delayUnit: String(step.delayUnit ?? step.unit ?? '').trim().toLowerCase(),
    body: optional(step.body ?? step.message),
    templateId: optional(step.templateId ?? step.fallbackTemplateId),
    mediaId: optional(step.mediaId),
    flowId: optional(step.flowId),
    templateLanguage: optional(step.templateLanguage)
  })) : [];
  return {
    ...payload,
    name: String(payload.name || '').trim(),
    description: optional(payload.description),
    whatsappAccountId: optional(payload.whatsappAccountId),
    stopOnLabelAdded: optional(payload.stopOnLabelAdded),
    steps
  };
}

function validateSequence(values) {
  const errors = {};
  if (!values.name) errors.name = 'Sequence name is required.';
  if (!values.steps.length) errors.steps = 'Add at least one reminder step.';
  values.steps.forEach((step, index) => {
    const prefix = `steps.${index}`;
    if (!Number.isInteger(step.delayValue) || step.delayValue < 0) errors[`${prefix}.delayValue`] = 'Send after must be a whole number of zero or more.';
    if (!DELAY_UNITS.has(step.delayUnit)) errors[`${prefix}.delayUnit`] = 'Unit must be minutes, hours, or days.';
    if (step.enabled !== false && step.sessionMessageType === 'text' && !step.body) errors[`${prefix}.body`] = 'Message is required.';
    if (step.templateId !== null && !/^\d+$/.test(String(step.templateId))) errors[`${prefix}.templateId`] = 'Fallback template is invalid.';
  });
  if (Object.keys(errors).length) throw validationError(errors);
}

function validateForActivation(sequence) {
  const errors = {};
  if (!String(sequence.name || '').trim()) errors.name = 'Sequence name is required.';
  const steps = [...(sequence.steps || [])].sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber));
  if (!steps.length) errors.steps = 'Add at least one reminder step.';
  steps.forEach((step, index) => {
    const prefix = `steps.${index}`;
    if (!Number.isInteger(Number(step.delayValue)) || Number(step.delayValue) <= 0) errors[`${prefix}.delayValue`] = 'Send after must be a positive whole number.';
    if (!DELAY_UNITS.has(step.delayUnit)) errors[`${prefix}.delayUnit`] = 'Unit must be minutes, hours, or days.';
    if (!String(step.body || '').trim()) errors[`${prefix}.body`] = 'Message is required.';
    if (Number(step.stepNumber) !== index + 1) errors[`${prefix}.stepNumber`] = 'Step ordering is invalid.';
  });
  if (Object.keys(errors).length) throw validationError(errors);
  return {
    warnings: steps.filter(step => !step.templateId).map((step, index) => ({
      field: `steps.${index}.templateId`,
      message: `Reminder ${index + 1} will not send outside the WhatsApp 24-hour service window without an approved fallback template.`
    }))
  };
}

class ReminderSequenceService {
  async listSequences(query = {}, userId = null) {
    const accessibleIds = userId ? await whatsappAccountAccess.accessibleIds(userId) : null;
    const scope = accessibleIds === null ? {} : { [Op.or]: [{ whatsappAccountId: null }, { whatsappAccountId: { [Op.in]: accessibleIds } }] };
    const where = query.status ? { [Op.and]: [scope, { status: query.status }] } : scope;
    const limit = Math.min(Number(query.limit || 50), 200), offset = Math.max(Number(query.offset || 0), 0);
    const result = await models.ReminderSequence.findAndCountAll({ where, include: [{ model: models.ReminderSequenceStep, as: 'steps' }], order: [['created_at', 'DESC']], limit, offset, distinct: true });
    return { rows: result.rows, count: result.count, limit, offset };
  }
  async getSequence(id, userId = null) {
    const row = await models.ReminderSequence.findByPk(id, { include: [{ model: models.ReminderSequenceStep, as: 'steps' }] });
    if (!row) throw Object.assign(new Error('Reminder sequence not found.'), { status: 404 });
    if (userId && row.whatsappAccountId) await whatsappAccountAccess.assertAccess(row.whatsappAccountId, userId);
    return row;
  }
  async saveSequence(id, payload, userId) {
    const normalized = normalizeSequence(payload);
    validateSequence(normalized);
    if (normalized.whatsappAccountId) await whatsappAccountAccess.assertAccess(normalized.whatsappAccountId, userId);
    return models.sequelize.transaction(async transaction => {
      const values = { ...normalized, createdBy: userId, updatedBy: userId };
      delete values.id; delete values.steps;
      let row;
      if (id) {
        row = await models.ReminderSequence.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!row) throw Object.assign(new Error('Reminder sequence not found.'), { status: 404 });
        if (row.whatsappAccountId) await whatsappAccountAccess.assertAccess(row.whatsappAccountId, userId);
        await row.update(values, { transaction });
      } else {
        row = await models.ReminderSequence.create(values, { transaction });
      }
      if (Array.isArray(normalized.steps)) {
        const ids = [];
        for (let i = 0; i < normalized.steps.length; i++) {
          const stepValues = { ...normalized.steps[i], sequenceId: row.id, stepNumber: i + 1 };
          delete stepValues.id;
          delete stepValues.fallbackTemplateId;
          delete stepValues.sendAfter;
          delete stepValues.unit;
          delete stepValues.message;
          const [step] = await models.ReminderSequenceStep.upsert({ ...(normalized.steps[i].id ? { id: normalized.steps[i].id } : {}), ...stepValues }, { transaction, returning: true });
          ids.push(step.id);
        }
        await models.ReminderSequenceStep.destroy({ where: { sequenceId: row.id, ...(ids.length ? { id: { [Op.notIn]: ids } } : {}) }, transaction });
      }
      return models.ReminderSequence.findByPk(row.id, {
        include: [{ model: models.ReminderSequenceStep, as: 'steps' }],
        transaction
      });
    });
  }
  async changeSequenceStatus(id, requestedStatus, userId) {
    const status = String(requestedStatus || '').trim().toLowerCase();
    if (!REMINDER_SEQUENCE_STATUSES.has(status)) throw validationError({ status: 'Choose draft, active, paused, or archived.' });
    const operation = async (name, fn) => {
      try {
        return await fn();
      } catch (error) {
        logger.error('reminder_sequence_status_query_failed', {
          operation: name,
          sequenceId: String(id),
          status,
          databaseCode: error?.original?.code || error?.parent?.code || null,
          message: safeError(error?.original || error?.parent || error)
        });
        throw error;
      }
    };
    try {
      return await models.sequelize.transaction(async transaction => {
      // Lock only the sequence row. PostgreSQL rejects FOR UPDATE on the nullable
      // side of the LEFT JOIN Sequelize creates for an included steps collection.
      const row = await operation('lock_sequence', () => models.ReminderSequence.findByPk(id, {
        transaction, lock: transaction.LOCK.UPDATE
      }));
      if (!row) throw Object.assign(new Error('Reminder sequence not found.'), { status: 404 });
      if (row.whatsappAccountId) await operation('verify_whatsapp_account_access', () => whatsappAccountAccess.assertAccess(row.whatsappAccountId, userId));
      row.steps = await operation('load_sequence_steps', () => models.ReminderSequenceStep.findAll({
        where: { sequenceId: row.id }, order: [['step_number', 'ASC']], transaction
      }));
      if (row.status === status) return { sequence: row, warnings: [] };
      if (!REMINDER_SEQUENCE_TRANSITIONS[row.status]?.has(status)) throw Object.assign(new Error(`Cannot change reminder sequence from ${row.status} to ${status}.`), {
        status: 409, code: 'REMINDER_STATUS_TRANSITION_INVALID'
      });
      const result = status === REMINDER_SEQUENCE_STATUS.ACTIVE ? validateForActivation(row) : { warnings: [] };
      await operation('update_sequence_status', () => row.update({ status, updatedBy: userId }, { transaction }));
      return { sequence: row, warnings: result.warnings };
      });
    } catch (error) {
      logger.error('reminder_sequence_status_change_failed', {
        sequenceId: String(id), status,
        databaseCode: error?.original?.code || error?.parent?.code || null,
        message: safeError(error?.original || error?.parent || error)
      });
      throw error;
    }
  }
  async duplicateSequence(id, userId) {
    const source = await this.getSequence(id, userId);
    return this.saveSequence(null, {
      ...source.toJSON(),
      name: `${source.name} (Copy)`.slice(0, 180),
      status: REMINDER_SEQUENCE_STATUS.DRAFT,
      steps: source.steps.map(step => ({ ...step.toJSON(), id: undefined }))
    }, userId);
  }
  async removeSequence(id, userId) {
    const row = await this.getSequence(id, userId); await row.update({ updatedBy: userId }); await row.destroy(); return { id: row.id };
  }
  async subscribe(input, userId = null, existingTransaction = null) {
    const sequence = await this.getSequence(input.sequenceId);
    if (sequence.status !== 'active') throw Object.assign(new Error('Only active reminder sequences can be subscribed.'), { status: 409 });
    const conversation = await models.Conversation.findByPk(input.conversationId);
    if (!conversation || String(conversation.contactId) !== String(input.contactId) || String(conversation.whatsappAccountId) !== String(input.whatsappAccountId))
      throw Object.assign(new Error('Conversation, contact and WhatsApp account do not match.'), { status: 409, code: 'REMINDER_IDENTITY_MISMATCH' });
    if (sequence.whatsappAccountId && String(sequence.whatsappAccountId) !== String(input.whatsappAccountId))
      throw Object.assign(new Error('Sequence belongs to a different WhatsApp account.'), { status: 409, code: 'REMINDER_ACCOUNT_MISMATCH' });
    const phone = conversation.normalizedPhone || input.phone;
    if (!phone) throw Object.assign(new Error('Conversation has no phone identity.'), { status: 409 });
    const createSubscription = async transaction => {
      const existing = await models.ReminderSubscription.findOne({ where: { sequenceId: sequence.id, conversationId: conversation.id, status: ACTIVE }, transaction, lock: transaction.LOCK.UPDATE });
      if (existing) return existing;
      const first = sequence.steps.filter(s => s.enabled).sort((a, b) => a.stepNumber - b.stepNumber)[0];
      if (!first) throw Object.assign(new Error('Sequence has no enabled steps.'), { status: 409 });
      const scheduledAt = new Date(Date.now() + delayMs(first));
      const subscription = await models.ReminderSubscription.create({
        ...input, phone, subscribedBy: userId, currentStep: 0, subscribedAt: new Date(), nextRunAt: scheduledAt
      }, { transaction });
      await models.ReminderExecution.create({ subscriptionId: subscription.id, sequenceStepId: first.id, conversationId: conversation.id, whatsappAccountId: conversation.whatsappAccountId, scheduledAt }, { transaction });
      return subscription;
    };
    return existingTransaction ? createSubscription(existingTransaction) : models.sequelize.transaction(createSubscription);
  }
  async changeStatus(id, action) {
    const row = await models.ReminderSubscription.findByPk(id);
    if (!row) throw Object.assign(new Error('Subscription not found.'), { status: 404 });
    if (action === 'pause' && row.status === 'active') await row.update({ status: 'paused' });
    else if (action === 'resume' && row.status === 'paused') await row.update({ status: 'active' });
    else if (['cancel', 'unsubscribe'].includes(action) && ACTIVE.includes(row.status)) {
      await row.update({ status: 'cancelled', cancelledAt: new Date(), nextRunAt: null });
      await models.ReminderExecution.update({ status: 'cancelled' }, { where: { subscriptionId: row.id, status: 'scheduled' } });
    }
    return row;
  }
  async processDue(limit = Number(process.env.REMINDER_WORKER_BATCH_SIZE || 20)) {
    const claimed = await models.sequelize.transaction(async transaction => {
      const rows = await models.ReminderExecution.findAll({ where: { status: 'scheduled', scheduledAt: { [Op.lte]: new Date() } }, order: [['scheduled_at', 'ASC']], limit, transaction, lock: transaction.LOCK.UPDATE, skipLocked: true });
      for (const row of rows) await row.update({ status: 'processing', startedAt: new Date(), attemptCount: row.attemptCount + 1 }, { transaction });
      return rows.map(r => r.id);
    });
    const results = [];
    for (const id of claimed) results.push(await this.processOne(id));
    return results;
  }
  async processOne(id) {
    const execution = await models.ReminderExecution.findByPk(id);
    const subscription = execution && await models.ReminderSubscription.findByPk(execution.subscriptionId);
    if (!execution || !subscription || subscription.status !== 'active') {
      if (execution?.status === 'processing') await execution.update({ status: 'cancelled', errorCode: 'SUBSCRIPTION_NOT_ACTIVE', errorMessage: 'Subscription is not active.' });
      return execution;
    }
    const [sequence, step, conversation] = await Promise.all([models.ReminderSequence.findByPk(subscription.sequenceId), models.ReminderSequenceStep.findByPk(execution.sequenceStepId), models.Conversation.findByPk(subscription.conversationId)]);
    if (!sequence || !step || !conversation || String(conversation.contactId) !== String(subscription.contactId) || String(conversation.whatsappAccountId) !== String(subscription.whatsappAccountId)) {
      await execution.update({ status: 'failed', errorCode: 'IDENTITY_MISMATCH', errorMessage: 'Stored reminder identity no longer matches the conversation.' }); await subscription.update({ status: 'failed', nextRunAt: null }); return execution;
    }
    try {
      const window = await compliance.isConversationWindowOpen(subscription.contactId, subscription.whatsappAccountId, subscription.conversationId);
      let response;
      if (!window.open) {
        if (!step.templateId) return this.block(execution, subscription, step, 'OUTSIDE_WINDOW_TEMPLATE_REQUIRED', 'Outside the 24-hour window; an approved account template is required.');
        const template = await models.WhatsAppTemplate.findOne({ where: { id: step.templateId, whatsappAccountId: subscription.whatsappAccountId, status: 'APPROVED' } });
        if (!template || (step.templateLanguage && template.language && step.templateLanguage !== template.language)) return this.block(execution, subscription, step, 'INVALID_FALLBACK_TEMPLATE', 'Configured fallback template is not approved for this WhatsApp account and language.');
        response = await whatsapp.sendTemplateMessage({ to: subscription.phone, templateName: template.name, languageCode: step.templateLanguage || template.language, components: step.templateParameterMappings, whatsappAccountId: subscription.whatsappAccountId, log: false });
      } else {
        if (step.sessionMessageType !== 'text') throw Object.assign(new Error('This session message type requires media/flow dispatch configuration.'), { permanent: true, code: 'UNSUPPORTED_SESSION_TYPE' });
        response = await whatsapp.sendTextMessage({ to: subscription.phone, text: step.body || '', whatsappAccountId: subscription.whatsappAccountId, log: false });
      }
      await execution.update({ status: 'sent', sentAt: new Date(), whatsappMessageId: response?.messages?.[0]?.id || response?.id || null, errorCode: null, errorMessage: null });
      await this.scheduleNext(subscription, sequence, step);
    } catch (error) {
      const retry = !error.permanent && execution.attemptCount < Number(process.env.REMINDER_MAX_ATTEMPTS || 3);
      const next = retry ? new Date(Date.now() + Math.min(3600000, 60000 * (2 ** Math.max(0, execution.attemptCount - 1)))) : null;
      await execution.update({ status: retry ? 'scheduled' : 'failed', nextRetryAt: next, scheduledAt: next || execution.scheduledAt, errorCode: error.code || 'DELIVERY_FAILED', errorMessage: safeError(error) });
      if (!retry && !step.continueOnFailure) await subscription.update({ status: 'failed', nextRunAt: null });
      else if (!retry) await this.scheduleNext(subscription, sequence, step);
      logger.warn('reminder_execution_failed', { executionId: execution.id, code: error.code || 'DELIVERY_FAILED' });
    }
    return execution.reload();
  }
  async block(execution, subscription, step, code, message) {
    await execution.update({ status: 'skipped', errorCode: code, errorMessage: message });
    if (step.continueOnFailure) await this.scheduleNext(subscription, await models.ReminderSequence.findByPk(subscription.sequenceId), step);
    else await subscription.update({ status: 'failed', nextRunAt: null });
    return execution;
  }
  async scheduleNext(subscription, sequence, step) {
    const next = await models.ReminderSequenceStep.findOne({ where: { sequenceId: sequence.id, enabled: true, stepNumber: { [Op.gt]: step.stepNumber } }, order: [['step_number', 'ASC']] });
    if (!next) return subscription.update({ status: 'completed', currentStep: step.stepNumber, completedAt: new Date(), nextRunAt: null });
    const scheduledAt = new Date(Date.now() + delayMs(next));
    await models.sequelize.transaction(async transaction => {
      await models.ReminderExecution.findOrCreate({ where: { subscriptionId: subscription.id, sequenceStepId: next.id }, defaults: { conversationId: subscription.conversationId, whatsappAccountId: subscription.whatsappAccountId, scheduledAt }, transaction });
      await subscription.update({ currentStep: step.stepNumber, nextRunAt: scheduledAt }, { transaction });
    });
  }
  async stopForConversation(conversationId, reason = 'reply') {
    const map = { reply: 'stopped_by_reply', conversion: 'stopped_by_conversion', payment: 'stopped_by_payment' };
    const flag = { reply: 'stopOnCustomerReply', conversion: 'stopOnLeadConverted', payment: 'stopOnPaymentConfirmed' }[reason];
    const rows = await models.ReminderSubscription.findAll({ where: { conversationId, status: 'active' }, include: [{ model: models.ReminderSequence, as: 'sequence', where: { [flag]: true } }] });
    for (const row of rows) { await row.update({ status: map[reason], nextRunAt: null }); await models.ReminderExecution.update({ status: 'cancelled' }, { where: { subscriptionId: row.id, status: 'scheduled' } }); }
    return rows.length;
  }
  start(interval = Number(process.env.REMINDER_WORKER_INTERVAL_MS || 15000)) {
    if (!this.timer) this.timer = setInterval(() => this.processDue().catch(error => logger.error('reminder_worker_failed', { message: safeError(error) })), interval);
  }
}
module.exports = new ReminderSequenceService();
module.exports.ReminderSequenceService = ReminderSequenceService;

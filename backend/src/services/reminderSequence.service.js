const { Op } = require('sequelize');
const models = require('../models');
const whatsapp = require('./whatsapp.service');
const logger = require('../config/logger');
const whatsappAccountAccess = require('./whatsappAccountAccess.service');
const interactiveMedia = require('./interactiveMedia.service');
const buttonConfig = require('./whatsappButtonConfig.service');
const { REMINDER_SEQUENCE_STATUS, REMINDER_SEQUENCE_STATUSES, REMINDER_SEQUENCE_TRANSITIONS } = require('../constants/reminderSequenceStatus');

const ACTIVE = ['active', 'paused'];
const DELAY_UNITS = new Set(['minutes', 'hours', 'days']);
const REPLY_POLICIES = new Set(['postpone', 'continue', 'pause', 'stop', 'complete', 'flow_decides']);
const delayMs = (step) => Number(step.delayValue) * ({ minutes: 60000, hours: 3600000, days: 86400000 }[step.delayUnit] || 60000);
const replySchedule = ({ receivedAt, existingNextRunAt, value = 4, unit = 'hours' }) => { const resumeAt = new Date(new Date(receivedAt).getTime() + Number(value) * ({ minutes: 60000, hours: 3600000, days: 86400000 }[unit] || 3600000)); return { resumeAt, nextRunAt: new Date(Math.max(existingNextRunAt ? new Date(existingNextRunAt).getTime() : 0, resumeAt.getTime())) }; };
const safeError = (error) => String(error?.message || 'Delivery failed').replace(/(bearer|api[_ -]?key|token)\s*[:=]?\s*\S+/ig, '$1 [redacted]').slice(0, 1000);
const optional = value => value === undefined || value === null || String(value).trim() === '' ? null : value;
const validationError = errors => Object.assign(new Error('Validation failed'), {
  status: 422, code: 'VALIDATION_FAILED', errors
});
const conflictError = (message, errors) => Object.assign(new Error(message), {
  status: 409, code: 'REMINDER_SEQUENCE_CONFLICT', errors
});

function normalizeSequence(payload = {}) {
  const steps = Array.isArray(payload.steps) ? payload.steps.map((step = {}) => ({
    ...step,
    delayValue: Number(step.delayValue ?? step.sendAfter),
    delayUnit: String(step.delayUnit ?? step.unit ?? '').trim().toLowerCase(),
    body: optional(step.body ?? step.message),
    footer: optional(step.footer),
    sessionMessageType: String(step.sessionMessageType || step.messageType || 'text').toLowerCase(),
    mediaConfig: step.mediaConfig || {},
    interactiveConfig: step.interactiveConfig || { buttons: step.buttons || [] },
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
    replyPolicy: optional(payload.replyPolicy),
    replyCooldownValue: Number(payload.replyCooldownValue ?? 4),
    replyCooldownUnit: String(payload.replyCooldownUnit || 'hours').toLowerCase(),
    steps
  };
}

function validateSequence(values) {
  const errors = {};
  if (!values.name) errors.name = 'Sequence name is required.';
  if (!values.steps.length) errors.steps = 'Add at least one reminder step.';
  if (values.replyPolicy && !REPLY_POLICIES.has(values.replyPolicy)) errors.replyPolicy = 'Choose a valid recipient reply policy.';
  if (values.replyPolicy === 'postpone' && (!Number.isInteger(values.replyCooldownValue) || values.replyCooldownValue < 1)) errors.replyCooldownValue = 'Reply cooldown must be a positive whole number.';
  if (values.replyPolicy === 'postpone' && !DELAY_UNITS.has(values.replyCooldownUnit)) errors.replyCooldownUnit = 'Choose minutes, hours, or days.';
  values.steps.forEach((step, index) => {
    const prefix = `steps.${index}`;
    if (!Number.isInteger(step.delayValue) || step.delayValue < 0) errors[`${prefix}.delayValue`] = 'Send after must be a whole number of zero or more.';
    if (!DELAY_UNITS.has(step.delayUnit)) errors[`${prefix}.delayUnit`] = 'Unit must be minutes, hours, or days.';
    if (step.enabled !== false && step.sessionMessageType === 'text' && !step.body) errors[`${prefix}.body`] = 'Message is required.';
    if (step.enabled !== false && ['image', 'buttons', 'image_buttons'].includes(step.sessionMessageType) && !step.body) errors[`${prefix}.body`] = 'Message body/caption is required.';
    if (['image', 'image_buttons'].includes(step.sessionMessageType) && !Object.keys(step.mediaConfig || {}).length) errors[`${prefix}.mediaConfig`] = 'Select an image before saving this reminder.';
    if (['buttons', 'image_buttons'].includes(step.sessionMessageType)) Object.assign(errors, buttonConfig.validateButtons(step.interactiveConfig, `${prefix}.interactiveConfig.buttons`).errors);
  });
  if (Object.keys(errors).length) throw validationError(errors);
}

async function validateReferences(values, transaction, { activation = false } = {}) {
  const errors = {};
  for (let index = 0; index < values.steps.length; index++) {
    const step = values.steps[index];
    const prefix = `steps.${index}`;
    const buttons = buttonConfig.normalizeButtons(step.interactiveConfig);
    const flowIds = [...new Set(buttons.flatMap(button => [
      button.behavior === 'start_flow' ? button.flowId : null,
      button.primaryActionType === 'START_FLOW' ? button.primaryActionConfig?.targetFlowId : null
    ]).filter(Boolean).map(String))];
    for (const flowId of flowIds) {
      const flow = await models.Flow.findByPk(flowId, { transaction });
      if (!flow || flow.status !== 'published' || (flow.whatsappAccountId && String(flow.whatsappAccountId) !== String(values.whatsappAccountId))) {
        errors[`${prefix}.interactiveConfig.buttons`] = 'Selected Flow must be published and belong to this WhatsApp account.';
      }
    }
  }
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
    if (['image', 'image_buttons'].includes(step.sessionMessageType) && (!step.mediaConfig?.mediaId || step.mediaConfig?.uploadStatus === 'processing' || step.mediaConfig?.uploadStatus === 'failed')) errors[`${prefix}.mediaConfig`] = 'Required image is missing, inaccessible, or still processing.';
    if (['buttons', 'image_buttons'].includes(step.sessionMessageType)) Object.assign(errors, buttonConfig.validateButtons(step.interactiveConfig, `${prefix}.interactiveConfig.buttons`).errors);
    if (Number(step.stepNumber) !== index + 1) errors[`${prefix}.stepNumber`] = 'Step ordering is invalid.';
  });
  if (Object.keys(errors).length) throw validationError(errors);
  return { warnings: [] };
}

class ReminderSequenceService {
  async uploadMedia(payload = {}, userId = null) {
    const whatsappAccountId = payload.whatsappAccountId || null;
    if (!whatsappAccountId) throw validationError({ whatsappAccountId: 'Select a WhatsApp account before uploading an image.' });
    await whatsappAccountAccess.assertAccess(whatsappAccountId, userId);
    return interactiveMedia.storeAndUpload({
      scope: 'reminder', scopeId: payload.sequenceId || 'draft', buffer: payload.buffer,
      fileName: payload.fileName, mimeType: payload.mimeType, mediaType: 'image', whatsappAccountId
    });
  }
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
      await validateReferences(normalized, transaction, { activation: normalized.status === REMINDER_SEQUENCE_STATUS.ACTIVE });
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
        const existing = id ? await models.ReminderSequenceStep.findAll({
          where: { sequenceId: row.id }, transaction, lock: transaction.LOCK.UPDATE
        }) : [];
        const existingById = new Map(existing.map(step => [String(step.id), step]));
        const requestedIds = normalized.steps.filter(step => step.id != null).map(step => String(step.id));
        const duplicateRequestedId = requestedIds.find((stepId, index) => requestedIds.indexOf(stepId) !== index);
        if (duplicateRequestedId) throw conflictError('A reminder step was submitted more than once.', { steps: 'Reminder step IDs must be unique.' });
        const missingId = requestedIds.find(stepId => !existingById.has(stepId));
        if (missingId) throw Object.assign(new Error('Reminder step not found in this sequence.'), { status: 404, code: 'REMINDER_STEP_NOT_FOUND' });
        if (existing.length) await models.ReminderSequenceStep.update(
          { stepNumber: models.sequelize.literal(`step_number + ${normalized.steps.length + existing.length + 1000}`) },
          { where: { sequenceId: row.id }, transaction }
        );
        const ids = [];
        for (let i = 0; i < normalized.steps.length; i++) {
          const stepValues = { ...normalized.steps[i], sequenceId: row.id, stepNumber: i + 1 };
          delete stepValues.id;
          delete stepValues.fallbackTemplateId;
          delete stepValues.sendAfter;
          delete stepValues.unit;
          delete stepValues.message;
          let step;
          if (normalized.steps[i].id != null) {
            step = existingById.get(String(normalized.steps[i].id));
            await step.update(stepValues, { transaction });
          } else {
            step = await models.ReminderSequenceStep.create(stepValues, { transaction });
          }
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
    const requested = String(requestedStatus || '').trim().toLowerCase();
    const status = ({ activate: 'active', resume: 'active', pause: 'paused', archive: 'archived' })[requested] || requested;
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
        status: 409, code: 'INVALID_SEQUENCE_TRANSITION'
      });
      const result = status === REMINDER_SEQUENCE_STATUS.ACTIVE ? validateForActivation(row) : { warnings: [] };
      if (status === REMINDER_SEQUENCE_STATUS.ACTIVE) await validateReferences({
        whatsappAccountId: row.whatsappAccountId,
        steps: row.steps
      }, transaction, { activation: true });
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
    return models.sequelize.transaction(async transaction => {
      const row = await models.ReminderSequence.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw Object.assign(new Error('Reminder sequence not found.'), { status: 404 });
      if (row.whatsappAccountId) await whatsappAccountAccess.assertAccess(row.whatsappAccountId, userId);
      const [subscriptions, blockingSubscriptions, executions] = await Promise.all([
        models.ReminderSubscription.count({ where: { sequenceId: row.id }, transaction }),
        models.ReminderSubscription.count({ where: { sequenceId: row.id, status: { [Op.in]: ['active', 'paused'] } }, transaction }),
        models.ReminderExecution.count({ where: { sequenceId: row.id }, transaction })
      ]);
      const counts = { subscriptions, activeOrPausedSubscriptions: blockingSubscriptions, executions };
      if (row.status === 'active' || blockingSubscriptions) throw Object.assign(new Error('Sequence cannot be deleted while it or its subscriptions are active.'), { status: 409, code: 'REMINDER_SEQUENCE_DELETE_BLOCKED', details: counts });
      const hardDelete = row.status === 'draft' && subscriptions === 0 && executions === 0;
      if (!hardDelete && row.status !== 'archived') throw Object.assign(new Error('Archive this sequence before permanent deletion.'), { status: 409, code: 'REMINDER_SEQUENCE_DELETE_BLOCKED', details: counts });
      await models.AuditLog.create({ userId, action: hardDelete ? 'reminder_sequence.hard_deleted' : 'reminder_sequence.soft_deleted', entityType: 'reminder_sequence', entityId: String(row.id), changes: { name: row.name, status: row.status, counts } }, { transaction });
      await row.update({ updatedBy: userId }, { transaction });
      await row.destroy({ transaction, force: hardDelete });
      return { id: row.id, deletion: hardDelete ? 'hard' : 'soft', counts };
    });
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
    else if (action === 'resume' && ['paused','stopped_by_reply'].includes(row.status)) {
      const sequence = await models.ReminderSequence.findByPk(row.sequenceId);
      const cooldown = Number(sequence?.replyCooldownValue || 4) * ({ minutes: 60000, hours: 3600000, days: 86400000 }[sequence?.replyCooldownUnit] || 3600000);
      const nextRunAt = row.status === 'stopped_by_reply' ? new Date(Date.now() + cooldown) : (row.metadata?.previousNextRunAt || row.nextRunAt || new Date());
      await row.update({ status: 'active', nextRunAt, ...(row.status === 'stopped_by_reply' ? { replyResumeAt: nextRunAt } : {}) });
      const next = await models.ReminderSequenceStep.findOne({ where: { sequenceId: row.sequenceId, enabled: true, stepNumber: { [Op.gt]: row.currentStep } }, order: [['step_number','ASC']] });
      if (next) {
        const [execution] = await models.ReminderExecution.findOrCreate({ where: { subscriptionId: row.id, sequenceStepId: next.id }, defaults: { conversationId: row.conversationId, whatsappAccountId: row.whatsappAccountId, scheduledAt: nextRunAt } });
        if (!['sent','delivered','read'].includes(execution.status)) await execution.update({ status: 'scheduled', scheduledAt: nextRunAt, errorCode: null, errorMessage: null });
      }
    }
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
      const safeToSend = await models.sequelize.transaction(async transaction => {
        const locked = await models.ReminderSubscription.findByPk(subscription.id, { transaction, lock: transaction.LOCK.UPDATE });
        const now = new Date();
        const alreadySent = await models.ReminderExecution.findOne({ where: { subscriptionId: locked.id, sequenceStepId: step.id, status: { [Op.in]: ['sent','delivered','read'] }, id: { [Op.ne]: execution.id } }, transaction });
        const notDue = locked.status !== 'active' || (locked.nextRunAt && now < locked.nextRunAt) || (locked.replyResumeAt && now < locked.replyResumeAt);
        if (alreadySent) { await execution.update({ status: 'cancelled', errorCode: 'DUPLICATE_STEP_EXECUTION' }, { transaction }); return false; }
        if (notDue) { const due = [locked.nextRunAt, locked.replyResumeAt].filter(Boolean).sort((a,b)=>new Date(b)-new Date(a))[0]; await execution.update({ status: locked.status === 'active' ? 'scheduled' : 'cancelled', ...(due ? { scheduledAt: due } : {}), errorCode: 'REPLY_POLICY_NOT_DUE' }, { transaction }); return false; }
        return true;
      });
      if (!safeToSend) return execution.reload();
      const window = await require('./messagingWindow.service').getMessagingWindow(subscription.conversationId, subscription.whatsappAccountId);
      let response;
      if (!window.isOpen) {
        await execution.update({ status: 'failed', failedAt: new Date(), whatsappMessageId: null, serviceWindowDecision: 'messaging_window_closed', errorCode: 'MESSAGING_WINDOW_CLOSED', errorMessage: 'Customer messaging window was closed when this reminder became due.' });
        await this.scheduleNext(subscription, sequence, step);
        return execution.reload();
      } else {
        if (step.sessionMessageType === 'text') response = await whatsapp.sendTextMessage({ to: subscription.phone, text: step.body || '', whatsappAccountId: subscription.whatsappAccountId, log: false });
        else {
          const withImage = ['image', 'image_buttons'].includes(step.sessionMessageType);
          const withButtons = ['buttons', 'image_buttons'].includes(step.sessionMessageType);
          const resolved = withImage ? await interactiveMedia.resolveHeader({ type: 'image', ...(step.mediaConfig || {}) }, { whatsappAccountId: subscription.whatsappAccountId, interactiveType: 'button' }) : { header: null, binding: null };
          if (withButtons) {
            response = await whatsapp.sendInteractiveMessage({ to: subscription.phone, body: step.body, footer: step.footer, header: resolved.header, buttons: buttonConfig.metaReplyButtons(step.interactiveConfig), whatsappAccountId: subscription.whatsappAccountId, log: false });
          } else {
            response = await whatsapp.sendMediaMessage({ to: subscription.phone, mediaType: 'image', mediaId: resolved.binding.mediaId, caption: step.body, whatsappAccountId: subscription.whatsappAccountId, log: false });
          }
          await execution.update({ metaMediaId: resolved.binding?.mediaId || null });
        }
        await execution.update({ sequenceId: sequence.id, messageType: step.sessionMessageType, mediaRecordId: step.mediaId, serviceWindowDecision: 'inside_24h', buttonConfigurationSnapshot: step.interactiveConfig || {} });
      }
      const whatsappMessageId = response?.messages?.[0]?.id || response?.id || null;
      if (!whatsappMessageId) throw Object.assign(new Error('WhatsApp accepted no message identifier.'), { code: 'WHATSAPP_MESSAGE_ID_MISSING', permanent: true });
      await execution.update({ status: 'sent', sentAt: new Date(), whatsappMessageId, errorCode: null, errorMessage: null });
      await this.scheduleNext(subscription, sequence, step);
    } catch (error) {
      const meta = error.response?.data?.error || error.whatsappApiResponse?.error || error.metaError?.error || {};
      const failureMessage = meta.error_user_msg || meta.message || error.message || 'Delivery failed';
      const failureCode = String(meta.code || error.code || 'DELIVERY_FAILED');
      await execution.update({ status: 'failed', failedAt: new Date(), nextRetryAt: null, whatsappMessageId: null, errorCode: failureCode, errorMessage: safeError(new Error(failureMessage)) });
      await this.scheduleNext(subscription, sequence, step);
      logger.warn('reminder_execution_failed', { executionId: execution.id, code: failureCode });
    }
    return execution.reload();
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
  async applyRecipientReply({ conversationId, whatsappMessageId, receivedAt = new Date(), replyToWhatsappMessageId = null, buttonPayload = null } = {}) {
    if (!conversationId || !whatsappMessageId) return 0;
    const subscriptions = await models.ReminderSubscription.findAll({ where: { conversationId, status: { [Op.in]: ['active','paused'] } }, include: [{ model: models.ReminderSequence, as: 'sequence' }] });
    let changed = 0;
    for (const item of subscriptions) {
      await models.sequelize.transaction(async transaction => {
        const subscription = await models.ReminderSubscription.findByPk(item.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!subscription || !['active','paused'].includes(subscription.status) || subscription.lastRecipientReplyMessageId === String(whatsappMessageId)) return;
        if (buttonPayload && replyToWhatsappMessageId) {
          const source = await models.ReminderExecution.findOne({ where: { whatsappMessageId: replyToWhatsappMessageId, subscriptionId: subscription.id }, transaction });
          const explicit = buttonConfig.normalizeButtons(source?.buttonConfigurationSnapshot).find(button => button.buttonId === String(buttonPayload));
          if (explicit && explicit.sequenceBehavior && !['flow_decides'].includes(explicit.sequenceBehavior)) return;
        }
        const sequence = item.sequence || await models.ReminderSequence.findByPk(subscription.sequenceId, { transaction });
        const policy = sequence.replyPolicy || (sequence.stopOnCustomerReply ? 'stop' : 'continue');
        const base = { lastRecipientReplyAt: receivedAt, lastRecipientReplyMessageId: String(whatsappMessageId) };
        if (policy === 'postpone') {
          const { resumeAt, nextRunAt } = replySchedule({ receivedAt, existingNextRunAt: subscription.nextRunAt, value: sequence.replyCooldownValue, unit: sequence.replyCooldownUnit });
          await subscription.update({ ...base, status: 'active', replyResumeAt: resumeAt, nextRunAt }, { transaction });
          const [rescheduled] = await models.ReminderExecution.update({ scheduledAt: nextRunAt, errorCode: 'RECIPIENT_REPLY_COOLDOWN', errorMessage: 'Pending execution rescheduled after recipient reply.', metadata: { previousDueAt: subscription.nextRunAt, replyResumeAt: resumeAt, inboundWhatsappMessageId: whatsappMessageId } }, { where: { subscriptionId: subscription.id, status: 'scheduled' }, transaction });
          const pendingStep = await models.ReminderSequenceStep.findOne({ where: { sequenceId: subscription.sequenceId, enabled: true, stepNumber: { [Op.gt]: subscription.currentStep } }, order: [['step_number','ASC']], transaction });
          if (!rescheduled && pendingStep) await models.ReminderExecution.findOrCreate({ where: { subscriptionId: subscription.id, sequenceStepId: pendingStep.id }, defaults: { conversationId: subscription.conversationId, whatsappAccountId: subscription.whatsappAccountId, scheduledAt: nextRunAt }, transaction });
        } else if (policy === 'pause') await subscription.update({ ...base, status: 'paused', metadata: { ...(subscription.metadata||{}), pausedReason: 'recipient_reply', previousNextRunAt: subscription.nextRunAt }, nextRunAt: null }, { transaction });
        else if (policy === 'stop') await subscription.update({ ...base, status: 'stopped_by_reply', stoppedByReplyAt: receivedAt, cancelledAt: receivedAt, nextRunAt: null }, { transaction });
        else if (policy === 'complete') await subscription.update({ ...base, status: 'completed', completedAt: receivedAt, nextRunAt: null }, { transaction });
        else await subscription.update(base, { transaction });
        changed += 1;
      });
    }
    return changed;
  }
  async stopForConversation(conversationId, reason = 'reply') {
    if (reason === 'reply') return this.applyRecipientReply({ conversationId, whatsappMessageId: `legacy:${Date.now()}` });
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
module.exports.replySchedule = replySchedule;
module.exports.normalizeSequence = normalizeSequence;
module.exports.validateSequence = validateSequence;

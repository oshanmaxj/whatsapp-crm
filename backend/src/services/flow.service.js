const fs = require('fs');
const os = require('os');
const path = require('path');
const { Op, fn, col } = require('sequelize');
const {
  Contact,
  Conversation,
  Appointment,
  Flow,
  FlowConnection,
  FlowNode,
  FlowRun,
  FlowRunLog,
  FlowRunLink,
  Lead,
  Message,
  Role,
  User,
  sequelize
} = require('../models');
const assignmentService = require('./assignment.service');
const googleSheetsService = require('./googleSheets.service');
const leadService = require('./lead.service');
const whatsappService = require('./whatsapp.service');
const outboundHistoryService = require('./outboundHistory.service');
const assignmentNotificationService = require('./assignmentNotification.service');
const aiService = require('./ai.service');
const whatsappAccountService = require('./whatsappAccount.service');
const whatsappAccountAccessService = require('./whatsappAccountAccess.service');
const flowActionService = require('./flowAction.service');
const triggerMatcher = require('./flowTriggerMatcher.service');

const MAX_NESTED_FLOW_DEPTH = Number(process.env.MAX_NESTED_FLOW_DEPTH || 5);

const MESSAGE_TYPES = new Set([
  'text_message', 'image_message', 'video_message', 'audio_message', 'file_document', 'location',
  'interactive_message', 'button_message', 'list_message', 'whatsapp_flow', 'appointment_booking',
  'ai_reply', 'ai_assistant'
]);

function render(text = '', context = {}) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const aliases = {
      LEAD_USER_FIRST_NAME: context.contact?.firstName || context.contact?.name?.split(' ')?.[0],
      'lead.course': context.lead?.courseInterested,
      'agent.name': context.agent?.name,
      'department.name': context.department?.name
    };
    if (aliases[key] !== undefined && aliases[key] !== null) return String(aliases[key]);
    const value = key.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), context);
    return value === undefined || value === null ? '' : String(value);
  });
}

function contactName(contact) {
  if (!contact) return '';
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.phone || '';
}

function normalizeTriggerKeywords(value) {
  const list = Array.isArray(value)
    ? value.flatMap((item) => String(item).split(','))
    : String(value || '').split(',');
  return list
    .map((item) => item.normalize('NFC').trim().replace(/\s+/gu, ' '))
    .filter(Boolean)
    .filter((item, index, rows) => rows.indexOf(item) === index);
}

function normalizeKeywords(value) {
  return normalizeTriggerKeywords(value);
}

function matchesTriggerKeyword(messageText, keywords, mode = 'contains') {
  const text = String(messageText || '').trim().toLowerCase();
  const list = normalizeTriggerKeywords(keywords).map((keyword) => keyword.toLocaleLowerCase('und'));
  if (!text || list.length === 0) return false;
  return list.some((keyword) => {
    if (mode === 'exact') return text === keyword;
    if (mode === 'starts_with') return text.startsWith(keyword);
    return text.includes(keyword);
  });
}

function isLocalhostUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.local');
  } catch {
    return false;
  }
}

function requireHttpsUrl(value, label = 'Media URL') {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw Object.assign(new Error(`${label} must be a valid HTTPS URL`), { status: 422 });
  }
  if (url.protocol !== 'https:' || isLocalhostUrl(value)) {
    throw Object.assign(new Error(`${label} must be a public HTTPS URL. Localhost and HTTP URLs cannot be sent by WhatsApp.`), { status: 422 });
  }
  return url.toString();
}

function stableButtonId(button, index) {
  const source = button.id || button.payload || button.title || `option_${index + 1}`;
  return String(source).trim().replace(/\s+/g, '_').toLowerCase();
}

function normalizeButtons(buttons = []) {
  const rows = Array.isArray(buttons)
    ? buttons
    : String(buttons || '').split(',').map((title) => ({ title: title.trim() })).filter((item) => item.title);
  return rows.map((button, index) => ({
    ...button,
    id: stableButtonId(button, index),
    payload: button.payload || stableButtonId(button, index),
    title: String(button.title || button.label || button.id || `Option ${index + 1}`).trim().slice(0, 20)
  })).filter((button) => button.id && button.title);
}

function encodedButtonId(flowId, nodeKey, buttonId) {
  return `flowbtn:${flowId}:${nodeKey}:${buttonId}`.slice(0, 256);
}

function decodedButtonId(payload) {
  const parts = String(payload || '').split(':');
  return parts[0] === 'flowbtn' && parts.length >= 4 ? parts.slice(3).join(':') : String(payload || '');
}

function serializeFlow(flow) {
  const plain = typeof flow?.toJSON === 'function' ? flow.toJSON() : flow;
  if (!plain) return null;
  plain.executions = plain.runs?.length || plain.executions || 0;
  return plain;
}

class FlowService {
  includeBuilder() {
    return [
      { model: FlowNode, as: 'nodes', required: false },
      { model: FlowConnection, as: 'connections', required: false },
      { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'], required: false }
    ];
  }

  async list(userId = null) {
    const accessWhere = userId ? await whatsappAccountAccessService.whereForUser(userId) : {};
    const context = userId ? await whatsappAccountAccessService.userContext(userId) : null;
    const departmentWhere = context && !context.isAdmin
      ? { [Op.or]: [{ departmentId: null }, { departmentId: { [Op.in]: (context.user.roles || []).map((role) => role.id) } }] }
      : {};
    const flows = await Flow.findAll({
      where: Object.keys(departmentWhere).length ? { [Op.and]: [accessWhere, departmentWhere] } : accessWhere,
      include: [{ model: FlowRun, as: 'runs', attributes: ['id', 'status'], required: false }],
      order: [['updated_at', 'DESC']]
    });
    return flows.map(serializeFlow);
  }

  async actionOptions(userId = null, currentFlowId = null) {
    const accessWhere = userId ? await whatsappAccountAccessService.whereForUser(userId) : {};
    const [labels, lists, sequences, departments, users, flows, courses, campaigns] = await Promise.all([
      require('../models').Label.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
      require('../models').ContactList.findAll({ where: { status: 'active' }, attributes: ['id', 'name', 'status'], order: [['name', 'ASC']] }),
      require('../models').Sequence.findAll({ where: { status: 'active' }, attributes: ['id', 'name', 'status'], order: [['name', 'ASC']] }),
      Role.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
      User.findAll({ where: { status: { [Op.ne]: 'inactive' } }, attributes: ['id', 'firstName', 'lastName', 'email', 'status'], order: [['first_name', 'ASC']] }),
      Flow.findAll({ where: { status: 'published', id: { [Op.ne]: currentFlowId || 0 }, ...accessWhere }, attributes: ['id', 'name', 'status', 'whatsappAccountId'], order: [['name', 'ASC']] }),
      require('../models').Course.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
      require('../models').Campaign.findAll({ attributes: ['id', 'name', 'status', 'whatsappAccountId'], order: [['name', 'ASC']] })
    ]);
    return {
      labels, lists, sequences, departments, courses,
      campaigns: campaigns.map((item) => ({ id: item.id, name: item.name, status: item.status, accountId: item.whatsappAccountId })),
      agents: users.map((user) => ({ id: user.id, name: contactName(user) || user.email, status: user.status })),
      flows: flows.map((flow) => ({ id: flow.id, name: flow.name, status: flow.status, scope: flow.whatsappAccountId ? 'account' : 'global', accountId: flow.whatsappAccountId })),
      customFields: [
        { id: 'contact.custom', name: 'Contact custom field', scope: 'contact' },
        { id: 'lead.custom', name: 'Lead custom field', scope: 'lead' },
        { id: 'conversation.custom', name: 'Conversation custom field', scope: 'conversation' }
      ]
    };
  }

  async validateForPublication(id) {
    const flow = await this.get(id);
    const details = [...this.validateFlow(flow), ...await this.validateFlowReferences(flow)];
    return { valid: !details.some((item) => item.severity !== 'warning'), details };
  }

  async simulateTrigger(id, event = {}, { allowRegex = false } = {}) {
    const flow = await this.get(id);
    return { matched: triggerMatcher.matchesTrigger(flow, { ...event, whatsappAccountId: event.whatsappAccountId || flow.whatsappAccountId }, { allowRegex }), actions: (flow.triggerConfig?.automationActions || []).filter((action) => action.enabled !== false).map((action) => ({ actionType: action.actionType, phase: action.phase || 'pre', executionOrder: action.executionOrder || 0 })) };
  }

  async get(id, userId = null) {
    const accessWhere = userId ? await whatsappAccountAccessService.whereForUser(userId) : {};
    const context = userId ? await whatsappAccountAccessService.userContext(userId) : null;
    const departmentWhere = context && !context.isAdmin
      ? { [Op.or]: [{ departmentId: null }, { departmentId: { [Op.in]: (context.user.roles || []).map((role) => role.id) } }] }
      : {};
    const flow = await Flow.findOne({
      where: Object.keys(departmentWhere).length
        ? { [Op.and]: [{ id, ...accessWhere }, departmentWhere] }
        : { id, ...accessWhere },
      include: this.includeBuilder(),
      order: [[{ model: FlowNode, as: 'nodes' }, 'id', 'ASC'], [{ model: FlowConnection, as: 'connections' }, 'id', 'ASC']]
    });
    if (!flow) throw Object.assign(new Error('Flow not found'), { status: 404 });
    return flow;
  }

  async create(payload, createdBy) {
    const selectedAccountId = await whatsappAccountAccessService.resolveSelection(payload.whatsappAccountId, createdBy);
    await whatsappAccountAccessService.assertDepartmentAccess(payload.departmentId, createdBy);
    const defaultAccount = selectedAccountId ? null : await whatsappAccountService.runtimeConfig().catch(() => null);
    const flow = await Flow.create({
      name: payload.name || 'Untitled Flow',
      description: payload.description || null,
      status: payload.status || 'draft',
      triggerType: payload.triggerType || 'keyword',
      triggerKeywords: normalizeKeywords(payload.triggerKeywords),
      triggerConfig: payload.triggerConfig || {
        source: 'inbound_message',
        matchType: 'contains',
        keywords: normalizeKeywords(payload.triggerKeywords)
      },
      whatsappPhoneNumberId: payload.whatsappPhoneNumberId || null,
      whatsappAccountId: selectedAccountId || defaultAccount?.whatsappAccountId || null,
      departmentId: payload.departmentId || null,
      createdBy
    });
    return this.get(flow.id);
  }

  async update(id, payload) {
    const flow = await this.get(id);
    await flow.update({
      name: payload.name ?? flow.name,
      description: payload.description ?? flow.description,
      status: payload.status ?? flow.status,
      triggerType: payload.triggerType ?? flow.triggerType,
      triggerKeywords: payload.triggerKeywords !== undefined ? normalizeKeywords(payload.triggerKeywords) : flow.triggerKeywords,
      triggerConfig: payload.triggerConfig ?? flow.triggerConfig,
      whatsappPhoneNumberId: payload.whatsappPhoneNumberId ?? flow.whatsappPhoneNumberId
      , whatsappAccountId: payload.whatsappAccountId ?? flow.whatsappAccountId
      , departmentId: payload.departmentId !== undefined ? (payload.departmentId || null) : flow.departmentId
    });
    return this.get(id);
  }

  async remove(id) {
    const flow = await this.get(id);
    await FlowRunLog.destroy({ where: { flowRunId: { [Op.in]: (await FlowRun.findAll({ where: { flowId: id }, attributes: ['id'], raw: true })).map((row) => row.id) } } });
    await FlowRun.destroy({ where: { flowId: id } });
    await FlowConnection.destroy({ where: { flowId: id } });
    await FlowNode.destroy({ where: { flowId: id } });
    await flow.destroy();
    return { deleted: true, id };
  }

  async saveBuilder(id, payload) {
    await this.update(id, payload.flow || payload);
    await FlowNode.destroy({ where: { flowId: id } });
    await FlowConnection.destroy({ where: { flowId: id } });
    const nodes = payload.nodes || [];
    const connections = payload.connections || payload.edges || [];
    await FlowNode.bulkCreate(nodes.map((node) => ({
      flowId: id,
      nodeKey: node.nodeKey || node.id,
      nodeType: node.nodeType || node.type || node.data?.nodeType || 'text_message',
      label: node.label || node.data?.label || 'Flow Node',
      positionX: node.positionX ?? node.position?.x ?? 0,
      positionY: node.positionY ?? node.position?.y ?? 0,
      configJson: node.configJson || node.data?.config || {},
      stats: node.stats || node.data?.stats || {}
    })));
    await FlowConnection.bulkCreate(connections.map((edge) => ({
      flowId: id,
      sourceNodeKey: edge.sourceNodeKey || edge.source,
      sourceHandle: edge.sourceHandle || null,
      targetNodeKey: edge.targetNodeKey || edge.target,
      targetHandle: edge.targetHandle || null,
      conditionLabel: edge.conditionLabel || edge.label || null,
      condition: edge.condition || edge.data?.condition || {}
    })).filter((edge) => edge.sourceNodeKey && edge.targetNodeKey));
    return this.get(id);
  }

  async publish(id) {
    const flow = await this.get(id);
    const errors = this.validateFlow(flow);
    errors.push(...await this.validateFlowReferences(flow));
    if (errors.some((item) => item.severity !== 'warning')) throw Object.assign(new Error('Flow validation failed'), { status: 422, details: errors });
    await flow.update({ status: 'published' });
    return this.get(id);
  }

  async unpublish(id) {
    const flow = await this.get(id);
    await flow.update({ status: 'inactive' });
    return this.get(id);
  }

  validateFlow(flow) {
    const nodes = flow.nodes || [];
    const edges = flow.connections || [];
    const errors = [];
    const keys = new Set(nodes.map((node) => node.nodeKey));
    if (!nodes.some((node) => node.nodeType === 'start')) errors.push({ field: 'nodes', message: 'A Start node is required.' });
    edges.forEach((edge) => {
      if (!keys.has(edge.sourceNodeKey) || !keys.has(edge.targetNodeKey)) {
        errors.push({ field: 'connections', message: `Connection ${edge.id || ''} points to a missing node.` });
      }
    });
    for (const node of nodes) {
      const config = node.configJson || {};
      const missing = (value) => !String(value ?? '').trim();
      const addRequired = (condition, message) => {
        if (condition) errors.push({ nodeKey: node.nodeKey, message });
      };
      if (['text_message', 'interactive_message', 'button_message', 'list_message'].includes(node.nodeType)) {
        addRequired(missing(config.message), 'Message body is required.');
      }
      if (node.nodeType === 'interactive_message') {
        addRequired(config.headerType === 'text' && missing(config.headerText), 'Header text is required.');
        addRequired(config.headerType === 'media' && missing(config.headerMediaUrl), 'Header media is required.');
      }
      if (node.nodeType === 'image_message' || node.nodeType === 'video_message' || node.nodeType === 'audio_message') {
        if (node.nodeType === 'image_message') {
          const sourceType = config.sourceType || (config.whatsappMediaId ? 'media_id' : 'url');
          addRequired(sourceType === 'media_id' && missing(config.whatsappMediaId), 'WhatsApp media ID is required.');
          addRequired(sourceType === 'url' && missing(config.imageUrl || config.mediaUrl), 'A public HTTPS image URL is required.');
          addRequired(sourceType === 'upload' && missing(config.whatsappMediaId), 'Upload the image before publishing.');
          if (sourceType === 'url' && !missing(config.imageUrl || config.mediaUrl)) {
            try { requireHttpsUrl(config.imageUrl || config.mediaUrl, 'Image URL'); } catch (error) { errors.push({ nodeKey: node.nodeKey, message: error.message }); }
          }
        } else {
          addRequired(missing(config.mediaUrl), 'Media is required.');
        }
      }
      if (node.nodeType === 'file_document') {
        addRequired(missing(config.fileUrl), 'Document is required.');
        addRequired(missing(config.fileName), 'Document filename is required.');
      }
      if (node.nodeType === 'ai_reply') {
        addRequired(missing(config.prompt), 'AI prompt is required.');
        addRequired(missing(config.fallbackMessage), 'AI fallback message is required.');
      }
      if (node.nodeType === 'assign') {
        addRequired(missing(config.departmentId) && missing(config.assignedAgentId), 'A department or user assignment is required.');
      }
      if (node.nodeType === 'delay_wait') {
        addRequired(!Number(config.amount) || Number(config.amount) < 1, 'Delay must be at least 1.');
        addRequired(missing(config.unit), 'Delay unit is required.');
      }
      if (node.nodeType === 'user_input') {
        addRequired(missing(config.question), 'User input question is required.');
        addRequired(missing(config.saveAs), 'User input answer field is required.');
        addRequired(!Number(config.timeoutMinutes) || Number(config.timeoutMinutes) < 1, 'User input timeout must be at least 1 minute.');
      }
      if (['interactive_message', 'button_message', 'list_message'].includes(node.nodeType)) {
        const options = config.buttons || config.rows || config.sections?.flatMap((section) => section.rows || []) || [];
        const normalized = Array.isArray(options) ? options : String(options || '').split(',').filter(Boolean);
        addRequired(!normalized.length, 'At least one button or option is required.');
        addRequired(['interactive_message', 'button_message'].includes(node.nodeType) && normalized.length > 3, 'WhatsApp reply messages support at most 3 buttons.');
        addRequired(node.nodeType === 'list_message' && normalized.length > 10, 'A WhatsApp list section supports at most 10 rows.');
        for (const option of normalized) {
          const handle = typeof option === 'string' ? option.trim() : option.id || option.payload || option.title;
          addRequired(typeof option !== 'string' && missing(option.title || option.label), 'Every button or option needs a label.');
          addRequired(typeof option !== 'string' && String(option.title || option.label || '').length > (node.nodeType === 'list_message' ? 24 : 20), `Option titles may contain at most ${node.nodeType === 'list_message' ? 24 : 20} characters.`);
          addRequired(String(handle || '').length > 160, 'Stable button IDs may contain at most 160 characters.');
          if (typeof option !== 'string') {
            const actionType = String(option.primaryActionType || option.actionType || 'CONTINUE_FLOW').toUpperCase();
            addRequired(!['SEND_MESSAGE', 'START_FLOW', 'CONTINUE_FLOW', 'OPEN_URL', 'CALL_PHONE', 'SYSTEM_DEFAULT_ACTION', 'REPLY', 'URL', 'PHONE'].includes(actionType), 'Button action type is invalid.');
            addRequired(actionType === 'SEND_MESSAGE' && missing(option.primaryActionConfig?.message || option.message), 'Send Message button requires a message.');
            addRequired(actionType === 'START_FLOW' && missing(option.primaryActionConfig?.targetFlowId || option.targetFlowId), 'Start Flow button requires a target flow.');
            addRequired(actionType === 'OPEN_URL' && !/^https:\/\//i.test(option.primaryActionConfig?.url || option.url || ''), 'Open URL button requires an HTTPS URL.');
            addRequired(actionType === 'CALL_PHONE' && !/^\+?[0-9 ()-]{7,20}$/.test(option.primaryActionConfig?.phone || option.phone || ''), 'Call Phone button requires a valid phone number.');
            if (actionType === 'OPEN_URL') errors.push({ nodeKey: node.nodeKey, severity: 'warning', message: 'Regular WhatsApp reply buttons cannot open a URL and return a press webhook. Use an approved URL CTA template when native opening is required; CTA clicks cannot run button automations.' });
            if (actionType === 'CALL_PHONE') errors.push({ nodeKey: node.nodeKey, severity: 'warning', message: 'Call Phone is only native in supported approved templates. Regular WhatsApp reply buttons return a webhook but cannot initiate a call.' });
            for (const issue of flowActionService.validateActions(option.automationActions || [])) errors.push({ nodeKey: node.nodeKey, message: `Button action ${issue.index + 1}: ${issue.message}` });
          }
          if (handle && !edges.some((edge) => edge.sourceNodeKey === node.nodeKey && edge.sourceHandle === handle)
            && !edges.some((edge) => edge.sourceNodeKey === node.nodeKey && ['next', 'fallback'].includes(edge.sourceHandle))) {
            errors.push({ nodeKey: node.nodeKey, message: `Option "${handle}" needs a branch or fallback.` });
          }
        }
      }
      if (node.nodeType === 'start') for (const issue of flowActionService.validateActions(config.automationActions || [])) errors.push({ nodeKey: node.nodeKey, message: `Trigger action ${issue.index + 1}: ${issue.message}` });
    }
    const titles = new Map();
    for (const node of nodes.filter((item) => ['interactive_message', 'button_message'].includes(item.nodeType))) {
      for (const button of node.configJson?.buttons || []) {
        const title = String(button.title || '').trim().toLocaleLowerCase('und');
        if (!title) continue;
        const prior = titles.get(title);
        if (prior) errors.push({ nodeKey: node.nodeKey, severity: 'warning', message: `Button title "${button.title}" is also used on ${prior}; stable payload IDs will keep actions distinct.` });
        else titles.set(title, node.label);
      }
    }
    return errors;
  }

  async validateFlowReferences(flow) {
    const errors = [];
    const refs = (flow.nodes || []).flatMap((node) => (node.configJson?.buttons || []).map((button) => ({ node, target: button.primaryActionConfig?.targetFlowId || button.targetFlowId })).filter((item) => item.target));
    for (const ref of refs) {
      if (String(ref.target) === String(flow.id)) { errors.push({ nodeKey: ref.node.nodeKey, message: 'A flow cannot start itself.' }); continue; }
      const target = await Flow.findByPk(ref.target);
      if (!target || target.status !== 'published') errors.push({ nodeKey: ref.node.nodeKey, message: 'Target flow must exist and be published.' });
      else if (target.whatsappAccountId && String(target.whatsappAccountId) !== String(flow.whatsappAccountId)) errors.push({ nodeKey: ref.node.nodeKey, message: 'Target flow is not available to this WhatsApp account.' });
      else if (await this.flowReferenceReaches(ref.target, flow.id, new Set())) errors.push({ nodeKey: ref.node.nodeKey, message: 'Circular flow reference detected.' });
    }
    return errors;
  }

  async flowReferenceReaches(currentFlowId, targetFlowId, visited) {
    if (String(currentFlowId) === String(targetFlowId)) return true;
    if (visited.has(String(currentFlowId))) return false;
    visited.add(String(currentFlowId));
    const nodes = await FlowNode.findAll({ where: { flowId: currentFlowId }, attributes: ['configJson'] });
    const references = nodes.flatMap((node) => (node.configJson?.buttons || []).map((button) => button.primaryActionConfig?.targetFlowId || button.targetFlowId).filter(Boolean));
    for (const reference of references) if (await this.flowReferenceReaches(reference, targetFlowId, visited)) return true;
    return false;
  }

  async startFlowFromAction({ targetFlowId, contactId, conversationId, whatsappAccountId, sourceFlowRunId, sourceNodeId, variables = {}, actorType = 'system', transaction = null }) {
    const target = await Flow.findOne({ where: { id: targetFlowId, status: 'published' }, include: this.includeBuilder(), transaction });
    if (!target) throw Object.assign(new Error('Target flow is not published or enabled.'), { code: 'FLOW_TARGET_UNAVAILABLE', status: 422 });
    if (target.whatsappAccountId && String(target.whatsappAccountId) !== String(whatsappAccountId)) throw Object.assign(new Error('Target flow does not support this WhatsApp account.'), { code: 'FLOW_ACCOUNT_SCOPE_MISMATCH', status: 403 });
    const conversation = await Conversation.findByPk(conversationId, { transaction });
    if (!conversation || String(conversation.contactId) !== String(contactId) || String(conversation.whatsappAccountId) !== String(whatsappAccountId)) throw Object.assign(new Error('Canonical conversation context does not match the target flow action.'), { code: 'FLOW_CANONICAL_CONTEXT_MISMATCH', status: 409 });
    let depth = 0;
    const ancestors = new Set([String(targetFlowId)]);
    let cursor = sourceFlowRunId ? await FlowRun.findByPk(sourceFlowRunId, { transaction }) : null;
    while (cursor) {
      depth += 1;
      if (depth > MAX_NESTED_FLOW_DEPTH) throw Object.assign(new Error('Maximum nested-flow depth exceeded.'), { code: 'FLOW_NESTED_DEPTH_EXCEEDED', status: 422 });
      if (ancestors.has(String(cursor.flowId))) throw Object.assign(new Error('Circular flow reference detected.'), { code: 'FLOW_CIRCULAR_REFERENCE', status: 422 });
      ancestors.add(String(cursor.flowId));
      const parentLink = await FlowRunLink.findOne({ where: { childFlowRunId: cursor.id }, transaction });
      cursor = parentLink ? await FlowRun.findByPk(parentLink.parentFlowRunId, { transaction }) : null;
    }
    const result = await this.executeFlow(target, { contactId, conversationId, whatsappAccountId, variables, actor: { type: actorType }, nestedDepth: depth + 1 }, {});
    if (sourceFlowRunId && result?.id) await FlowRunLink.findOrCreate({ where: { childFlowRunId: result.id }, defaults: { parentFlowRunId: sourceFlowRunId, childFlowRunId: result.id, sourceNodeKey: sourceNodeId || null }, transaction });
    return result;
  }

  async duplicate(id, createdBy) {
    const source = await this.get(id);
    const copy = await Flow.create({
      name: `${source.name} (Copy)`,
      description: source.description,
      status: 'draft',
      triggerType: source.triggerType,
      triggerKeywords: source.triggerKeywords,
      triggerConfig: source.triggerConfig,
      whatsappPhoneNumberId: source.whatsappPhoneNumberId,
      whatsappAccountId: source.whatsappAccountId,
      departmentId: source.departmentId,
      createdBy
    });
    await this.saveBuilder(copy.id, {
      nodes: (source.nodes || []).map((node) => ({
        id: node.nodeKey, nodeType: node.nodeType, label: node.label,
        positionX: node.positionX, positionY: node.positionY,
        configJson: node.configJson, stats: {}
      })),
      connections: (source.connections || []).map((edge) => ({
        source: edge.sourceNodeKey, target: edge.targetNodeKey,
        sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle,
        conditionLabel: edge.conditionLabel, condition: edge.condition
      }))
    });
    return this.get(copy.id);
  }

  async logs(id) {
    return FlowRunLog.findAll({
      include: [{ model: FlowRun, as: 'run', where: { flowId: id }, attributes: [] }],
      order: [['created_at', 'DESC']],
      limit: 500
    });
  }

  async createNode(flowId, payload) {
    await this.get(flowId);
    return FlowNode.create({
      flowId, nodeKey: payload.nodeKey || payload.id,
      nodeType: payload.nodeType || payload.type,
      label: payload.title || payload.label || 'Flow node',
      positionX: payload.positionX ?? payload.position?.x ?? 0,
      positionY: payload.positionY ?? payload.position?.y ?? 0,
      configJson: payload.config || payload.configJson || {},
      stats: payload.stats || {}
    });
  }

  async updateNode(flowId, nodeKey, payload) {
    const node = await FlowNode.findOne({ where: { flowId, nodeKey } });
    if (!node) throw Object.assign(new Error('Flow node not found'), { status: 404 });
    await node.update({
      nodeType: payload.nodeType ?? node.nodeType,
      label: payload.title ?? payload.label ?? node.label,
      positionX: payload.positionX ?? payload.position?.x ?? node.positionX,
      positionY: payload.positionY ?? payload.position?.y ?? node.positionY,
      configJson: payload.config ?? payload.configJson ?? node.configJson
    });
    return node;
  }

  async deleteNode(flowId, nodeKey) {
    return sequelize.transaction(async (transaction) => {
      const node = await FlowNode.findOne({ where: { flowId, nodeKey }, transaction });
      if (!node) throw Object.assign(new Error('Flow node not found'), { status: 404 });
      const connectionsDeleted = await FlowConnection.destroy({
        where: { flowId, [Op.or]: [{ sourceNodeKey: nodeKey }, { targetNodeKey: nodeKey }] },
        transaction
      });
      await node.destroy({ transaction });
      return { deleted: true, nodeKey, connectionsDeleted };
    });
  }

  async createConnection(flowId, payload) {
    await this.get(flowId);
    return FlowConnection.create({
      flowId,
      sourceNodeKey: payload.sourceNodeKey || payload.source,
      sourceHandle: payload.sourceHandle || null,
      targetNodeKey: payload.targetNodeKey || payload.target,
      targetHandle: payload.targetHandle || null,
      conditionLabel: payload.conditionLabel || payload.label || null,
      condition: payload.condition || {}
    });
  }

  async deleteConnection(flowId, connectionId) {
    const deleted = await FlowConnection.destroy({ where: { id: connectionId, flowId } });
    if (!deleted) throw Object.assign(new Error('Flow connection not found'), { status: 404 });
    return { deleted: true, id: connectionId };
  }

  async test(id, context = {}) {
    const flow = await this.get(id);
    return this.executeFlow(flow, { ...context, simulated: true }, { forceSimulated: true });
  }

  async analytics(id) {
    const runs = await FlowRun.findAll({ where: { flowId: id }, raw: true });
    const logs = await FlowRunLog.findAll({
      include: [{ model: FlowRun, as: 'run', where: { flowId: id }, attributes: [] }],
      attributes: ['nodeKey', 'nodeType', 'status', [fn('count', col('FlowRunLog.id')), 'count']],
      group: [
        col('FlowRunLog.node_key'),
        col('FlowRunLog.node_type'),
        col('FlowRunLog.status')
      ],
      raw: true
    });
    return {
      totalExecutions: runs.length,
      completed: runs.filter((run) => run.status === 'completed' || run.status === 'simulated').length,
      failed: runs.filter((run) => run.status === 'failed').length,
      running: runs.filter((run) => run.status === 'running').length,
      dropOffsByNode: logs.filter((log) => log.status === 'failed'),
      nodeStats: logs
    };
  }

  async runs(id) {
    return FlowRun.findAll({
      where: { flowId: id },
      include: [{ model: FlowRunLog, as: 'logs', required: false }],
      order: [['created_at', 'DESC'], [{ model: FlowRunLog, as: 'logs' }, 'created_at', 'ASC']],
      limit: 100
    });
  }

  async uploadFlowMedia(flowId, payload = {}) {
    const flow = await this.get(flowId);
    const mimeType = String(payload.mimeType || '').toLowerCase();
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    if (!allowed.has(mimeType)) {
      throw Object.assign(new Error('Flow images must be JPG, PNG, or WebP.'), { status: 422 });
    }
    const rawBase64 = String(payload.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length) throw Object.assign(new Error('Uploaded image is empty.'), { status: 422 });
    const safeName = String(payload.fileName || `flow-image-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempPath = path.join(os.tmpdir(), `${Date.now()}-${safeName}`);
    try {
      fs.writeFileSync(tempPath, buffer);
      const response = await whatsappService.uploadMedia({
        filePath: tempPath,
        mimeType,
        whatsappAccountId: flow.whatsappAccountId || payload.whatsappAccountId || null
      });
      if (!response?.id) throw Object.assign(new Error('WhatsApp media upload did not return a media ID.'), { status: 502 });
      return { whatsappMediaId: response.id, meta: response };
    } finally {
      fs.unlink(tempPath, () => {});
    }
  }

  firstNode(flow) {
    const incoming = new Set((flow.connections || []).map((edge) => edge.targetNodeKey));
    return (flow.nodes || []).find((node) => node.nodeType === 'start') || (flow.nodes || []).find((node) => !incoming.has(node.nodeKey)) || flow.nodes?.[0];
  }

  nextNode(flow, node, context, sourceHandle = null) {
    const edges = (flow.connections || []).filter((edge) => edge.sourceNodeKey === node.nodeKey);
    if (!edges.length) return null;
    if (sourceHandle) {
      const normalized = String(sourceHandle).toLowerCase();
      const matched = edges.find((edge) => (
        String(edge.sourceHandle || edge.conditionLabel || '').toLowerCase() === normalized
      ));
      const fallback = edges.find((edge) => ['fallback', 'next'].includes(String(edge.sourceHandle || '').toLowerCase()));
      const selected = matched || fallback;
      if (selected) return (flow.nodes || []).find((candidate) => candidate.nodeKey === selected.targetNodeKey);
    }
    if (node.nodeType === 'condition') {
      const config = node.configJson || {};
      const actual = config.field?.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), context);
      const matched = String(actual || '').toLowerCase() === String(config.value || '').toLowerCase();
      const preferred = edges.find((edge) => String(edge.conditionLabel || '').toLowerCase() === (matched ? 'true' : 'false'));
      return (flow.nodes || []).find((candidate) => candidate.nodeKey === (preferred || edges[0]).targetNodeKey);
    }
    return (flow.nodes || []).find((candidate) => candidate.nodeKey === edges[0].targetNodeKey);
  }

  async executeFlow(flow, context = {}, options = {}) {
    const contact = context.contactId ? await Contact.findByPk(context.contactId) : context.contact || null;
    const lead = context.leadId ? await Lead.findByPk(context.leadId) : context.lead || null;
    const conversation = context.conversationId
      ? await Conversation.findByPk(context.conversationId, {
          include: [
            { model: User, as: 'assignedUser', required: false },
            { model: Role, as: 'assignedRole', required: false }
          ]
        })
      : context.conversation || null;
    const contactData = contact?.toJSON ? contact.toJSON() : (contact || {});
    const leadData = lead?.toJSON ? lead.toJSON() : (lead || {});
    const run = options.run || await FlowRun.create({
      flowId: flow.id,
      contactId: contact?.id || context.contactId || null,
      conversationId: context.conversationId || context.conversation?.id || null,
      leadId: lead?.id || context.leadId || null,
      currentNodeKey: null,
      status: 'running',
      whatsappAccountId: flow.whatsappAccountId || context.whatsappAccountId || null,
      contextJson: context,
      lastWhatsappMessageId: context.whatsappMessageId || null
    });
    const runContext = {
      ...context,
      contact: contact ? { ...contactData, name: contactName(contact) } : context.contact || {},
      lead: leadData,
      conversation: conversation?.toJSON ? conversation.toJSON() : conversation || {},
      agent: conversation?.assignedUser
        ? { ...conversation.assignedUser.toJSON(), name: contactName(conversation.assignedUser) }
        : context.agent || {},
      department: conversation?.assignedRole?.toJSON ? conversation.assignedRole.toJSON() : context.department || {},
      createdAt: new Date().toISOString(),
      flowId: flow.id
      , whatsappAccountId: flow.whatsappAccountId || context.whatsappAccountId || conversation?.whatsappAccountId || contact?.whatsappAccountId || context.contact?.whatsappAccountId || null
    };

    let node = options.startNode || this.firstNode(flow);
    const visited = new Set();
    const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true' && !options.forceSimulated;

    try {
      while (node && !visited.has(node.nodeKey)) {
        visited.add(node.nodeKey);
        await run.update({ currentNodeKey: node.nodeKey, contextJson: runContext });
        const result = await this.executeNode({ flow, run, node, context: runContext, realSendEnabled });
        Object.assign(runContext, result.contextPatch || {});
        await this.incrementNodeStats(node, {
          subscribers: 1,
          sent: result.sent ? 1 : 0
        });
        if (result.wait) {
          await run.update({
            status: 'waiting',
            waitingForReply: result.waitingForReply !== false,
            waitingNodeKey: node.nodeKey,
            currentNodeKey: node.nodeKey,
            contextJson: runContext,
            lastWhatsappMessageId: result.whatsappMessageId || run.lastWhatsappMessageId
          });
          return this.getRun(run.id);
        }
        if (result.stop) break;
        if (node.nodeType === 'end_flow') break;
        node = this.nextNode(flow, node, runContext, result.sourceHandle);
      }
      await run.update({ status: realSendEnabled ? 'completed' : 'simulated', completedAt: new Date(), contextJson: runContext });
      await this.resumeParentAfterChild(run).catch(() => null);
      return this.getRun(run.id);
    } catch (error) {
      if (node) await this.incrementNodeStats(node, { errors: 1 });
      await run.update({
        status: 'failed',
        completedAt: new Date(),
        contextJson: runContext,
        errorMessage: error.message || 'Flow execution failed',
        failedNodeId: node?.nodeKey || null,
        failedNodeType: node?.nodeType || null,
        whatsappApiResponse: error.whatsappApiResponse || error.metaError || error.response?.data || null,
        payloadSent: error.payloadSent || null
      });
      throw error;
    }
  }

  async incrementNodeStats(node, patch) {
    const current = node.stats || {};
    const stats = { sent: 0, delivered: 0, read: 0, subscribers: 0, errors: 0, ...current };
    Object.entries(patch).forEach(([key, value]) => { stats[key] = Number(stats[key] || 0) + Number(value || 0); });
    await FlowNode.update({ stats }, { where: { id: node.id } }).catch(() => null);
    node.stats = stats;
  }

  async resumeParentAfterChild(childRun) {
    const link = await FlowRunLink.findOne({ where: { childFlowRunId: childRun.id } });
    if (!link) return null;
    const parent = await FlowRun.findByPk(link.parentFlowRunId);
    if (!parent || parent.status !== 'waiting' || !parent.contextJson?.resumeAfterChild) return null;
    const parentFlow = await this.get(parent.flowId);
    const source = (parentFlow.nodes || []).find((node) => node.nodeKey === link.sourceNodeKey);
    const next = source ? this.nextNode(parentFlow, source, parent.contextJson || {}, 'next') : null;
    if (!next) return parent.update({ status: 'completed', waitingForReply: false, waitingNodeKey: null, completedAt: new Date() });
    const resumedContext = { ...(parent.contextJson || {}), resumeAfterChild: false };
    await parent.update({ status: 'running', waitingForReply: false, waitingNodeKey: null, contextJson: resumedContext });
    return this.executeFlow(parentFlow, resumedContext, { run: parent, startNode: next });
  }

  async getRun(id) {
    return FlowRun.findByPk(id, { include: [{ model: FlowRunLog, as: 'logs' }, { model: Flow, as: 'flow' }] });
  }

  async log(run, node, status, inputJson = {}, outputJson = {}, errorMessage = null) {
    return FlowRunLog.create({
      flowRunId: run.id,
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      status,
      eventType: status,
      inputJson,
      outputJson,
      errorMessage
    });
  }

  async executeNode({ run, node, context, realSendEnabled }) {
    const config = node.configJson || {};
    try {
      if (node.nodeType === 'start') {
        const conversationId = context.conversationId || context.conversation?.id;
        if (conversationId && (config.departmentId || config.assignedUserId)) {
          await Conversation.update({
            ...(config.departmentId ? { assignedRoleId: config.departmentId } : {}),
            ...(config.assignedUserId ? { assignedUserId: config.assignedUserId } : {})
          }, { where: { id: conversationId } });
        }
        const actionContext = { ...context, flowRun: run, nodeKey: node.nodeKey, sourceMessageId: context.whatsappMessageId };
        const pre = await flowActionService.executeFlowActions({ actions: config.automationActions || [], context: actionContext, phase: 'pre' });
        const post = await flowActionService.executeFlowActions({ actions: config.automationActions || [], context: actionContext, phase: 'post' });
        await this.log(run, node, 'completed', context, { started: true, actions: [...pre.results, ...post.results] });
        return { stop: pre.directive === 'stop' || post.directive === 'stop', sourceHandle: pre.nodeKey || post.nodeKey || null };
      }
      if (MESSAGE_TYPES.has(node.nodeType)) {
        const output = await this.executeMessageNode(node, config, context, realSendEnabled);
        await this.log(run, node, output.status, context, output);
        const waitsForReply = ['button_message', 'list_message', 'interactive_message', 'whatsapp_flow', 'appointment_booking'].includes(node.nodeType);
        return {
          sent: output.status === 'completed',
          wait: waitsForReply && realSendEnabled,
          whatsappMessageId: output.response?.id || null
        };
      }
      if (node.nodeType === 'user_input') {
        if (!context.__replyingToNode || context.__replyingToNode !== node.nodeKey) {
          const output = await this.executeMessageNode(
            { ...node, nodeType: 'text_message' },
            { message: config.question || 'Please reply.' },
            context,
            realSendEnabled
          );
          await this.log(run, node, output.status, context, { question: config.question, waiting: true });
          const replyTimeoutAt = new Date(Date.now() + Number(config.timeoutMinutes || 60) * 60000).toISOString();
          return {
            wait: realSendEnabled,
            sent: output.status === 'completed',
            whatsappMessageId: output.response?.id || null,
            contextPatch: { resumeAt: replyTimeoutAt, replyTimeoutNodeKey: node.nodeKey }
          };
        }
        const key = config.saveAs || 'answer';
        const answer = context[key] || context.latestMessage || '';
        const patch = { [key]: answer, userInputs: { ...(context.userInputs || {}), [key]: answer } };
        if (key.startsWith('contact.') && (context.contactId || context.contact?.id)) {
          const field = key.slice('contact.'.length);
          if (['firstName', 'lastName', 'email', 'company', 'notes'].includes(field)) {
            await Contact.update({ [field]: answer }, { where: { id: context.contactId || context.contact.id } });
          }
        } else if (key.startsWith('lead.') && (context.leadId || context.lead?.id)) {
          const field = key.slice('lead.'.length);
          if (['status', 'source', 'notes', 'courseInterested', 'batchInterested', 'studentType'].includes(field)) {
            await leadService.updateLead(context.leadId || context.lead.id, { [field]: answer });
          }
        }
        await this.log(run, node, 'completed', context, { question: config.question, saveAs: key, answer });
        return { contextPatch: patch, sourceHandle: 'reply' };
      }
      if (node.nodeType === 'create_lead') {
        const contact = context.contact || {};
        const lead = await leadService.createManualLead({
          name: contact.name,
          phone: contact.phone || context.phone,
          email: contact.email,
          source: config.source || 'WhatsApp Ads',
          status: config.status || 'New',
          courseInterested: context.courseInterested || config.courseInterested,
          batchInterested: context.batchInterested || config.batchInterested,
          notes: config.notes || 'Created by WhatsApp Flow Builder'
        });
        await this.log(run, node, 'completed', context, { leadId: lead.id });
        return { contextPatch: { lead, leadId: lead.id } };
      }
      if (node.nodeType === 'update_lead' && (context.leadId || context.lead?.id)) {
        const lead = await leadService.updateLead(context.leadId || context.lead.id, config);
        await this.log(run, node, 'completed', context, { leadId: lead.id });
        return { contextPatch: { lead } };
      }
      if (['assign_agent', 'assign'].includes(node.nodeType)) {
        const assignedTo = config.assignedAgentId || config.agentId;
        let assignee = assignedTo ? await User.findByPk(assignedTo) : null;
        if (context.leadId || context.lead?.id) {
          const result = assignedTo
            ? await assignmentService.assignLead(context.leadId || context.lead.id, context.userId || null, { assignedTo, note: 'Assigned by Flow Builder' })
            : await assignmentService.assignLead(context.leadId || context.lead.id, context.userId || null, { note: 'Auto-assigned by Flow Builder' });
          assignee = result.assignee;
        }
        const conversationId = context.conversationId || context.conversation?.id;
        const conversation = conversationId ? await Conversation.findByPk(conversationId, {
          include: [{ model: Contact, as: 'contact', required: false }]
        }) : null;
        const departmentId = config.departmentId || config.assignedRoleId || null;
        const department = departmentId ? await Role.findByPk(departmentId) : null;
        if (conversation) {
          await conversation.update({
            assignedUserId: assignee?.id || conversation.assignedUserId,
            assignedRoleId: department?.id || conversation.assignedRoleId
          });
          await assignmentNotificationService.sendAssignmentNotification({
            conversation,
            assignedUser: assignee,
            department,
            assignedBy: context.userId ? await User.findByPk(context.userId) : null,
            assignedUserChanged: Boolean(assignee),
            departmentChanged: Boolean(department)
          });
        }
        await this.log(run, node, 'completed', context, { assignedTo: assignee?.id || null, departmentId: department?.id || null });
        return {};
      }
      if (node.nodeType === 'add_label') {
        const contactId = context.contactId || context.contact?.id;
        if (contactId) {
          const contact = await Contact.findByPk(contactId);
          const tags = [...new Set([...(contact.tags || []), config.label || config.labelName].filter(Boolean))];
          await contact.update({ tags });
          await this.log(run, node, 'completed', context, { contactId, tags });
        }
        return {};
      }
      if (node.nodeType === 'remove_label') {
        const contactId = context.contactId || context.contact?.id;
        const contact = contactId ? await Contact.findByPk(contactId) : null;
        if (contact) {
          const target = config.label || config.labelName;
          const tags = (contact.tags || []).filter((tag) => String(tag) !== String(target));
          await contact.update({ tags });
          await this.log(run, node, 'completed', context, { contactId, tags });
        }
        return {};
      }
      if (node.nodeType === 'delay_wait') {
        const amount = Number(config.amount || config.delayMinutes || 1);
        const multiplier = config.unit === 'days' ? 86400000 : config.unit === 'hours' ? 3600000 : 60000;
        const resumeAt = new Date(Date.now() + amount * multiplier).toISOString();
        await this.log(run, node, 'waiting', context, { resumeAt });
        return { wait: true, waitingForReply: false, contextPatch: { resumeAt, delayNodeKey: node.nodeKey } };
      }
      if (node.nodeType === 'create_followup') {
        await this.log(run, node, 'simulated', context, { note: 'Follow-up creation is available through existing workflow service; simulated here.' });
        return {};
      }
      if (node.nodeType === 'send_google_sheets') {
        const values = (config.columns || []).map((column) => render(column.value || '', context));
        const response = await googleSheetsService.appendRow({
          connectionId: config.connectionId,
          spreadsheetId: config.spreadsheetId,
          sheetName: config.sheetName,
          values
        });
        await this.log(run, node, 'completed', context, { updatedRange: response.updates?.updatedRange });
        return {};
      }
      await this.log(run, node, 'completed', context, { skipped: false });
      return {};
    } catch (error) {
      await this.log(run, node, 'failed', context, {
        whatsappApiResponse: error.whatsappApiResponse || error.metaError || error.response?.data || null,
        payloadSent: error.payloadSent || null
      }, error.message);
      throw error;
    }
  }

  async executeMessageNode(node, config, context, realSendEnabled) {
    const to = config.to || context.contact?.phone || context.phone;
    let text = render(config.message || config.caption || node.label || '', context);
    if ((node.nodeType === 'ai_reply' || node.nodeType === 'ai_assistant') && realSendEnabled) {
      text = await aiService.previewReply({
        messageText: [config.prompt || config.assistantInstructions, context.latestMessage].filter(Boolean).join('\n\n'),
        contact: context.contact,
        lead: context.lead
      }).catch(() => render(config.fallbackMessage || 'A team member will help you shortly.', context));
    }
    if (!realSendEnabled) return { status: 'simulated', to, text, nodeType: node.nodeType };
    let response;
    let storedType = 'text';
    let sentMediaId = null;
    let sentMediaUrl = null;
    let sentInteractiveType = null;
    if (node.nodeType === 'text_message' || node.nodeType.startsWith('ai_')) {
      response = await whatsappService.sendTextMessage({ to, text, log: false, whatsappAccountId: context.whatsappAccountId });
    } else if (['button_message', 'interactive_message'].includes(node.nodeType)) {
      const buttons = normalizeButtons(config.buttons).slice(0, 3);
      if (!buttons.length) throw Object.assign(new Error('Interactive button node requires at least one button.'), { status: 422 });
      const header = config.header || (
        config.headerType === 'text'
          ? { type: 'text', text: config.headerText }
          : config.headerType === 'media'
            ? { type: config.headerMediaType || 'image', url: config.headerMediaUrl }
            : null
      );
      const encoded = buttons.map((button) => ({ ...button, id: encodedButtonId(context.flowId, node.nodeKey, button.id) }));
      response = await whatsappService.sendInteractiveMessage({ to, body: text, footer: config.footer, header, buttons: encoded, log: false, whatsappAccountId: context.whatsappAccountId });
      sentInteractiveType = 'button';
    } else if (node.nodeType === 'list_message' || node.nodeType === 'appointment_booking') {
      const rows = node.nodeType === 'appointment_booking'
        ? (config.slots || []).map((slot) => ({ id: slot.id || slot.value || slot, title: slot.title || slot.label || slot }))
        : (config.rows || []);
      const sections = config.sections?.length
        ? config.sections
        : [{ title: config.sectionTitle || 'Options', rows }];
      const encodedSections = sections.map((section) => ({ ...section, rows: (section.rows || []).map((row, index) => ({ ...row, id: encodedButtonId(context.flowId, node.nodeKey, row.id || row.payload || `row_${index + 1}`) })) }));
      response = await whatsappService.sendInteractiveMessage({ to, body: text, footer: config.footer, sections: encodedSections, buttonText: String(config.buttonText || 'Choose').slice(0, 20), log: false, whatsappAccountId: context.whatsappAccountId });
      sentInteractiveType = 'list';
    } else if (node.nodeType === 'whatsapp_flow') {
      response = await whatsappService.sendWhatsAppFlowMessage({
        to, body: text, flowId: config.flowId, flowToken: config.flowToken,
        screen: config.screen, data: config.data || {}, whatsappAccountId: context.whatsappAccountId
      });
    } else if (node.nodeType === 'image_message') {
      storedType = 'image';
      const sourceType = config.sourceType || (config.whatsappMediaId ? 'media_id' : 'url');
      const mediaId = config.whatsappMediaId || config.mediaId || null;
      const imageUrl = config.imageUrl || config.mediaUrl || null;
      if (sourceType === 'media_id' || mediaId) {
        if (!mediaId) throw Object.assign(new Error('WhatsApp media ID is required for this image node.'), { status: 422 });
        response = await whatsappService.sendMediaMessage({ to, mediaType: 'image', mediaId, caption: text, log: false, whatsappAccountId: context.whatsappAccountId });
        sentMediaId = mediaId;
      } else {
        sentMediaUrl = requireHttpsUrl(imageUrl, 'Image URL');
        response = await whatsappService.sendMediaMessage({ to, mediaType: 'image', url: sentMediaUrl, caption: text, log: false, whatsappAccountId: context.whatsappAccountId });
      }
    } else if (node.nodeType === 'video_message') {
      storedType = 'video';
      response = await whatsappService.sendMediaMessage({ to, mediaType: 'video', url: config.mediaUrl, caption: text, log: false, whatsappAccountId: context.whatsappAccountId });
    } else if (node.nodeType === 'audio_message') {
      storedType = 'audio';
      response = await whatsappService.sendMediaMessage({ to, mediaType: 'audio', url: config.mediaUrl, log: false, whatsappAccountId: context.whatsappAccountId });
    } else if (node.nodeType === 'file_document') {
      storedType = 'document';
      response = await whatsappService.sendMediaMessage({ to, mediaType: 'document', url: config.fileUrl, filename: config.fileName, caption: text, log: false, whatsappAccountId: context.whatsappAccountId });
    } else if (node.nodeType === 'location') {
      storedType = 'location';
      response = await whatsappService.sendLocationMessage({ to, ...config, log: false, whatsappAccountId: context.whatsappAccountId });
    }
    await outboundHistoryService.record({
      conversationId: context.conversationId || context.conversation?.id || null,
      contactId: context.contactId || context.contact?.id || null,
      leadId: context.leadId || context.lead?.id || null,
      phone: to,
      whatsappMessageId: response?.id || null,
      type: storedType,
      messageType: 'flow_automation',
      text,
      mediaId: sentMediaId,
      mediaUrl: sentMediaUrl,
      interactiveType: sentInteractiveType,
      status: 'sent',
      whatsappAccountId: context.whatsappAccountId || null,
      rawPayload: { source: 'flow', flowId: context.flowId || null, nodeKey: node.nodeKey, whatsapp: response }
    });
    return { status: 'completed', response, to, text, nodeType: node.nodeType };
  }

  async executeButtonAction({ flow, run, node, button, context }) {
    const primary = String(button.primaryActionType || button.actionType || 'CONTINUE_FLOW').toUpperCase();
    const normalizedPrimary = primary === 'REPLY' ? 'CONTINUE_FLOW' : primary === 'URL' ? 'OPEN_URL' : primary === 'PHONE' ? 'CALL_PHONE' : primary;
    const actionContext = { ...context, flowRun: run, nodeKey: node.nodeKey, buttonId: button.id, sourceMessageId: context.whatsappMessageId };
    const pre = await flowActionService.executeFlowActions({ actions: button.automationActions || [], context: actionContext, phase: 'pre' });
    let primaryResult = {};
    if (pre.directive !== 'stop' && ['SEND_MESSAGE', 'START_FLOW'].includes(normalizedPrimary)) {
      primaryResult = await flowActionService.executeFlowActions({
        actions: [{ id: `primary:${button.id}`, actionType: normalizedPrimary, config: button.primaryActionConfig || button, enabled: true, executionOrder: 0, phase: 'primary', failurePolicy: 'STOP_FLOW' }],
        context: actionContext,
        phase: 'primary'
      });
    }
    const post = await flowActionService.executeFlowActions({ actions: button.automationActions || [], context: actionContext, phase: 'post' });
    const childRun = primaryResult.results?.find((item) => item.actionType === 'START_FLOW')?.output;
    const wantsPause = normalizedPrimary === 'START_FLOW' && button.primaryActionConfig?.pauseCurrentFlow === true;
    const childIsWaiting = childRun?.status === 'waiting';
    return {
      stop: pre.directive === 'stop' || primaryResult.directive === 'stop' || post.directive === 'stop' || (normalizedPrimary === 'START_FLOW' && button.primaryActionConfig?.stopCurrentFlow === true),
      pause: wantsPause && childIsWaiting,
      continueFlow: ['CONTINUE_FLOW', 'SEND_MESSAGE', 'SYSTEM_DEFAULT_ACTION'].includes(normalizedPrimary) || (normalizedPrimary === 'START_FLOW' && !button.primaryActionConfig?.stopCurrentFlow && (!wantsPause || !childIsWaiting)),
      actionType: normalizedPrimary,
      actions: [...pre.results, ...(primaryResult.results || []), ...post.results]
    };
  }

  async handleInboundMessage({
    text, contact, lead, conversation = null, messageType = 'text',
    interactiveType = null, buttonPayload = null, whatsappMessageId = null,
    replyToWhatsappMessageId = null, rawPayload = null, whatsappAccountId = null
  }) {
    if (!text) return null;
    if (whatsappMessageId) {
      const duplicate = await FlowRun.findOne({ where: { lastWhatsappMessageId: whatsappMessageId } });
      if (duplicate) return this.getRun(duplicate.id);
    }

    const waitingRun = contact?.id
      ? await FlowRun.findOne({
          where: { contactId: contact.id, whatsappAccountId, status: 'waiting', waitingForReply: true },
          order: [['updated_at', 'DESC']]
        })
      : null;
    if (waitingRun) {
      const flow = await this.get(waitingRun.flowId);
      const waitingNode = (flow.nodes || []).find((node) => node.nodeKey === waitingRun.waitingNodeKey);
      if (!waitingNode) {
        await waitingRun.update({ status: 'failed', waitingForReply: false, completedAt: new Date() });
        return this.getRun(waitingRun.id);
      }
      const context = {
        ...(waitingRun.contextJson || {}),
        latestMessage: text,
        buttonPayload,
        interactiveType,
        whatsappMessageId,
        replyToWhatsappMessageId,
        rawPayload,
        __replyingToNode: waitingNode.nodeKey
        , whatsappAccountId
      };
      if (waitingNode.nodeType === 'appointment_booking') {
        const appointmentAt = new Date(buttonPayload || text);
        if (!Number.isNaN(appointmentAt.getTime())) {
          const appointment = await Appointment.create({
            title: waitingNode.configJson?.title || 'Flow appointment',
            appointmentType: waitingNode.configJson?.appointmentType || 'Consultation',
            appointmentAt,
            durationMinutes: Number(waitingNode.configJson?.durationMinutes || 30),
            customerName: contactName(contact),
            customerPhone: contact?.phone,
            customerEmail: contact?.email || null,
            assignedAgentId: waitingNode.configJson?.assignedAgentId || null,
            contactId: contact?.id || null,
            leadId: lead?.id || null,
            notes: 'Created by Flow Builder'
          });
          context.appointment = appointment.toJSON();
        }
      }
      if (waitingNode.nodeType === 'whatsapp_flow' && rawPayload?.interactive?.nfm_reply?.response_json) {
        try {
          context.whatsappFlowData = JSON.parse(rawPayload.interactive.nfm_reply.response_json);
        } catch {
          context.whatsappFlowData = rawPayload.interactive.nfm_reply.response_json;
        }
      }
      const branch = waitingNode.nodeType === 'whatsapp_flow' ? 'next' : (buttonPayload || text);
      const stableBranch = decodedButtonId(branch);
      const buttons = waitingNode.configJson?.buttons || waitingNode.configJson?.rows || [];
      // New actions resolve only by the stable payload ID. Title matching is
      // retained solely for legacy transition-only definitions.
      const selectedButton = buttons.find((button) => String(button.id || button.payload || '') === stableBranch)
        || buttons.find((button) => !button.primaryActionType && String(button.title || '') === String(text || ''));
      const startNode = waitingNode.nodeType === 'user_input'
        ? waitingNode
        : this.nextNode(flow, waitingNode, context, stableBranch);
      await waitingRun.update({
        status: 'running',
        waitingForReply: false,
        waitingNodeKey: null,
        lastWhatsappMessageId: whatsappMessageId || waitingRun.lastWhatsappMessageId,
        contextJson: context
      });
      let selectedActionResult = null;
      if (selectedButton) {
        selectedActionResult = await this.executeButtonAction({ flow, run: waitingRun, node: waitingNode, button: selectedButton, context });
        await this.log(waitingRun, waitingNode, 'completed', context, { buttonId: selectedButton.id, actionType: selectedActionResult.actionType, actions: selectedActionResult.actions });
        if (selectedActionResult.stop) {
          await waitingRun.update({ status: 'completed', completedAt: new Date(), contextJson: context });
          return this.getRun(waitingRun.id);
        }
        if (selectedActionResult.pause) {
          context.resumeAfterChild = true;
          await waitingRun.update({ status: 'waiting', waitingForReply: false, waitingNodeKey: waitingNode.nodeKey, contextJson: context });
          return this.getRun(waitingRun.id);
        }
        if (!selectedActionResult.continueFlow) {
          await waitingRun.update({ status: 'completed', completedAt: new Date(), contextJson: context });
          return this.getRun(waitingRun.id);
        }
      }
      if (!startNode) {
        await waitingRun.update({ status: 'completed', completedAt: new Date() });
        return this.getRun(waitingRun.id);
      }
      return this.executeFlow(flow, context, { run: waitingRun, startNode });
    }

    const flows = await Flow.findAll({
      where: {
        status: 'published',
        [Op.and]: [
          { [Op.or]: [{ whatsappAccountId }, { whatsappAccountId: null }] },
          { [Op.or]: [{ departmentId: null }, { departmentId: conversation?.assignedRoleId || null }] }
        ]
      },
      include: this.includeBuilder()
    });
    const conversationMessageCount = conversation?.id ? await Message.count({ where: { conversationId: conversation.id } }) : null;
    const event = { text, messageType, interactiveType, buttonPayload, replyToWhatsappMessageId, whatsappAccountId, contact, lead, isFirstMessage: conversationMessageCount === 1 };
    const matched = flows.filter((candidate) => triggerMatcher.matchesTrigger(candidate, event, { allowRegex: candidate.triggerConfig?.regexPrivileged === true }))
      .sort((a, b) => Number(a.triggerConfig?.priority || 100) - Number(b.triggerConfig?.priority || 100));
    if (!matched.length) return null;
    const results = [];
    for (const flow of matched) {
      const prior = whatsappMessageId ? await FlowRun.findOne({ where: { flowId: flow.id, lastWhatsappMessageId: whatsappMessageId } }) : null;
      if (prior) { results.push(await this.getRun(prior.id)); continue; }
      results.push(await this.executeFlow(flow, {
      latestMessage: text,
      contactId: contact?.id,
      leadId: lead?.id,
      conversationId: conversation?.id || null,
      conversation,
      whatsappMessageId,
      messageType,
      interactiveType,
      buttonPayload,
      replyToWhatsappMessageId,
      rawPayload,
      contact: contact ? { ...contact.toJSON(), name: contactName(contact) } : null,
      lead: lead ? lead.toJSON() : null
      , whatsappAccountId
      }));
      if (flow.triggerConfig?.stopAfterMatch !== false) break;
    }
    return results.length === 1 ? results[0] : results;
  }

  async handleDomainEvent(event = {}) {
    const conversation = event.conversation || (event.conversationId ? await Conversation.findByPk(event.conversationId) : null);
    const contactId = event.contactId || conversation?.contactId || event.contact?.id || null;
    const leadId = event.leadId || conversation?.leadId || event.lead?.id || null;
    const contact = event.contact || (contactId ? await Contact.findByPk(contactId) : null);
    const lead = event.lead || (leadId ? await Lead.findByPk(leadId) : null);
    const whatsappAccountId = event.whatsappAccountId || conversation?.whatsappAccountId || contact?.whatsappAccountId || lead?.whatsappAccountId || null;
    const candidates = await Flow.findAll({ where: { status: 'published', [Op.or]: [{ whatsappAccountId }, { whatsappAccountId: null }] }, include: this.includeBuilder() });
    const matched = candidates.filter((candidate) => triggerMatcher.matchesTrigger(candidate, { ...event, contact, lead, whatsappAccountId }, { allowRegex: candidate.triggerConfig?.regexPrivileged === true })).sort((a, b) => Number(a.triggerConfig?.priority || 100) - Number(b.triggerConfig?.priority || 100));
    const results = [];
    const eventKey = event.eventId ? `event:${event.eventType}:${event.eventId}` : null;
    for (const candidate of matched) {
      const duplicate = eventKey ? await FlowRun.findOne({ where: { flowId: candidate.id, lastWhatsappMessageId: eventKey } }) : null;
      if (duplicate) { results.push(await this.getRun(duplicate.id)); continue; }
      results.push(await this.executeFlow(candidate, { ...event, contactId, leadId, conversationId: conversation?.id || event.conversationId || null, contact, lead, conversation, whatsappAccountId, whatsappMessageId: eventKey }));
      if (candidate.triggerConfig?.stopAfterMatch !== false) break;
    }
    return results;
  }

  async processDueWaitingRuns() {
    const candidates = await FlowRun.findAll({
      where: { status: 'waiting' },
      order: [['updated_at', 'ASC']],
      limit: 200
    });
    for (const run of candidates) {
      const resumeAt = run.contextJson?.resumeAt;
      if (!resumeAt || new Date(resumeAt).getTime() > Date.now()) continue;
      const flow = await this.get(run.flowId);
      const delayNode = (flow.nodes || []).find((node) => node.nodeKey === run.waitingNodeKey);
      const startNode = delayNode
        ? this.nextNode(flow, delayNode, run.contextJson || {}, delayNode.nodeType === 'user_input' ? 'timeout' : null)
        : null;
      if (!startNode) {
        await run.update({ status: 'completed', waitingForReply: false, waitingNodeKey: null, completedAt: new Date() });
        continue;
      }
      await run.update({ status: 'running', waitingForReply: false, waitingNodeKey: null });
      await this.executeFlow(flow, { ...(run.contextJson || {}), resumeAt: null }, { run, startNode });
    }
  }

  start(intervalMs = Number(process.env.FLOW_WORKER_INTERVAL_MS || 30000)) {
    if (this.timer) return;
    this.timer = setInterval(() => this.processDueWaitingRuns().catch(() => null), intervalMs);
  }
}

module.exports = new FlowService();
module.exports.FlowService = FlowService;
module.exports.encodedButtonId = encodedButtonId;
module.exports.decodedButtonId = decodedButtonId;

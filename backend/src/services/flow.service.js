const { Op, fn, col } = require('sequelize');
const {
  Contact,
  Flow,
  FlowConnection,
  FlowNode,
  FlowRun,
  FlowRunLog,
  Lead,
  User
} = require('../models');
const assignmentService = require('./assignment.service');
const googleSheetsService = require('./googleSheets.service');
const leadService = require('./lead.service');
const whatsappService = require('./whatsapp.service');

const MESSAGE_TYPES = new Set(['text_message', 'image_message', 'video_message', 'audio_message', 'file_document', 'location', 'button_message', 'list_message', 'ai_reply', 'ai_assistant']);

function render(text = '', context = {}) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), context);
    return value === undefined || value === null ? '' : String(value);
  });
}

function contactName(contact) {
  if (!contact) return '';
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.phone || '';
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
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

  async list() {
    const flows = await Flow.findAll({
      include: [{ model: FlowRun, as: 'runs', attributes: ['id', 'status'], required: false }],
      order: [['updated_at', 'DESC']]
    });
    return flows.map(serializeFlow);
  }

  async get(id) {
    const flow = await Flow.findByPk(id, {
      include: this.includeBuilder(),
      order: [[{ model: FlowNode, as: 'nodes' }, 'id', 'ASC'], [{ model: FlowConnection, as: 'connections' }, 'id', 'ASC']]
    });
    if (!flow) throw Object.assign(new Error('Flow not found'), { status: 404 });
    return flow;
  }

  async create(payload, createdBy) {
    const flow = await Flow.create({
      name: payload.name || 'Untitled Flow',
      description: payload.description || null,
      status: payload.status || 'draft',
      triggerType: payload.triggerType || 'keyword',
      triggerKeywords: normalizeKeywords(payload.triggerKeywords),
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
      triggerKeywords: payload.triggerKeywords !== undefined ? normalizeKeywords(payload.triggerKeywords) : flow.triggerKeywords
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
      configJson: node.configJson || node.data?.config || {}
    })));
    await FlowConnection.bulkCreate(connections.map((edge) => ({
      flowId: id,
      sourceNodeKey: edge.sourceNodeKey || edge.source,
      sourceHandle: edge.sourceHandle || null,
      targetNodeKey: edge.targetNodeKey || edge.target,
      targetHandle: edge.targetHandle || null,
      conditionLabel: edge.conditionLabel || edge.label || null
    })).filter((edge) => edge.sourceNodeKey && edge.targetNodeKey));
    return this.get(id);
  }

  async publish(id) {
    const flow = await this.get(id);
    await flow.update({ status: 'published' });
    return this.get(id);
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
      group: ['nodeKey', 'nodeType', 'status'],
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

  firstNode(flow) {
    const incoming = new Set((flow.connections || []).map((edge) => edge.targetNodeKey));
    return (flow.nodes || []).find((node) => node.nodeType === 'start') || (flow.nodes || []).find((node) => !incoming.has(node.nodeKey)) || flow.nodes?.[0];
  }

  nextNode(flow, node, context) {
    const edges = (flow.connections || []).filter((edge) => edge.sourceNodeKey === node.nodeKey);
    if (!edges.length) return null;
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
    const run = await FlowRun.create({
      flowId: flow.id,
      contactId: contact?.id || context.contactId || null,
      leadId: lead?.id || context.leadId || null,
      currentNodeKey: null,
      status: 'running',
      contextJson: context
    });
    const runContext = {
      ...context,
      contact: contact ? { ...contact.toJSON(), name: contactName(contact) } : context.contact || {},
      lead: lead ? lead.toJSON() : context.lead || {},
      createdAt: new Date().toISOString()
    };

    let node = this.firstNode(flow);
    const visited = new Set();
    const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true' && !options.forceSimulated;

    try {
      while (node && !visited.has(node.nodeKey)) {
        visited.add(node.nodeKey);
        await run.update({ currentNodeKey: node.nodeKey, contextJson: runContext });
        const result = await this.executeNode({ flow, run, node, context: runContext, realSendEnabled });
        Object.assign(runContext, result.contextPatch || {});
        if (node.nodeType === 'end_flow') break;
        node = this.nextNode(flow, node, runContext);
      }
      await run.update({ status: realSendEnabled ? 'completed' : 'simulated', completedAt: new Date(), contextJson: runContext });
      return this.getRun(run.id);
    } catch (error) {
      await run.update({ status: 'failed', completedAt: new Date(), contextJson: runContext });
      throw error;
    }
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
      inputJson,
      outputJson,
      errorMessage
    });
  }

  async executeNode({ run, node, context, realSendEnabled }) {
    const config = node.configJson || {};
    try {
      if (node.nodeType === 'start') {
        await this.log(run, node, 'completed', context, { started: true });
        return {};
      }
      if (MESSAGE_TYPES.has(node.nodeType)) {
        const output = await this.executeMessageNode(node, config, context, realSendEnabled);
        await this.log(run, node, output.status, context, output);
        return {};
      }
      if (node.nodeType === 'user_input') {
        const key = config.saveAs || 'answer';
        const answer = context[key] || context.latestMessage || '';
        const patch = { [key]: answer, userInputs: { ...(context.userInputs || {}), [key]: answer } };
        await this.log(run, node, 'completed', context, { question: config.question, saveAs: key, answer });
        return { contextPatch: patch };
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
      if (node.nodeType === 'assign_agent' && (context.leadId || context.lead?.id)) {
        const assignedTo = config.assignedAgentId || config.agentId;
        const result = assignedTo
          ? await assignmentService.assignLead(context.leadId || context.lead.id, context.userId || null, { assignedTo, note: 'Assigned by Flow Builder' })
          : await assignmentService.assignLead(context.leadId || context.lead.id, context.userId || null, { note: 'Auto-assigned by Flow Builder' });
        await this.log(run, node, 'completed', context, { assignedTo: result.assignee?.id });
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
      await this.log(run, node, 'failed', context, {}, error.message);
      throw error;
    }
  }

  async executeMessageNode(node, config, context, realSendEnabled) {
    const to = config.to || context.contact?.phone || context.phone;
    const text = render(config.message || config.caption || node.label || '', context);
    if (!realSendEnabled) return { status: 'simulated', to, text, nodeType: node.nodeType };
    if (node.nodeType === 'text_message' || node.nodeType === 'button_message' || node.nodeType === 'list_message' || node.nodeType.startsWith('ai_')) {
      return { status: 'completed', response: await whatsappService.sendTextMessage({ to, text }) };
    }
    if (node.nodeType === 'image_message') return { status: 'completed', response: await whatsappService.sendImageByUrl({ to, url: config.mediaUrl, caption: text }) };
    if (node.nodeType === 'video_message') return { status: 'completed', response: await whatsappService.sendVideoByUrl({ to, url: config.mediaUrl, caption: text }) };
    if (node.nodeType === 'audio_message') return { status: 'completed', response: await whatsappService.sendAudioByUrl({ to, url: config.mediaUrl }) };
    if (node.nodeType === 'file_document') return { status: 'completed', response: await whatsappService.sendDocumentByUrl({ to, url: config.fileUrl, filename: config.fileName, caption: text }) };
    if (node.nodeType === 'location') return { status: 'completed', response: await whatsappService.sendLocationMessage({ to, ...config }) };
    return { status: 'completed' };
  }

  async handleInboundMessage({ text, contact, lead }) {
    if (!text) return null;
    const flows = await Flow.findAll({ where: { status: 'published' }, include: this.includeBuilder() });
    const normalized = String(text).trim().toLowerCase();
    const flow = flows.find((candidate) => (candidate.triggerKeywords || []).some((keyword) => normalized.includes(String(keyword).toLowerCase())));
    if (!flow) return null;
    return this.executeFlow(flow, {
      latestMessage: text,
      contactId: contact?.id,
      leadId: lead?.id,
      contact: contact ? { ...contact.toJSON(), name: contactName(contact) } : null,
      lead: lead ? lead.toJSON() : null
    });
  }
}

module.exports = new FlowService();

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
  Lead,
  Role,
  User
} = require('../models');
const assignmentService = require('./assignment.service');
const googleSheetsService = require('./googleSheets.service');
const leadService = require('./lead.service');
const whatsappService = require('./whatsapp.service');
const outboundHistoryService = require('./outboundHistory.service');
const assignmentNotificationService = require('./assignmentNotification.service');
const aiService = require('./ai.service');

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
      triggerConfig: payload.triggerConfig || {
        source: 'inbound_message',
        matchType: 'contains',
        keywords: normalizeKeywords(payload.triggerKeywords)
      },
      whatsappPhoneNumberId: payload.whatsappPhoneNumberId || null,
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
    if (errors.length) throw Object.assign(new Error('Flow validation failed'), { status: 422, details: errors });
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
      if (node.nodeType === 'text_message' && !String(config.message || '').trim()) errors.push({ nodeKey: node.nodeKey, message: 'Text message body is required.' });
      if (['interactive_message', 'button_message', 'list_message'].includes(node.nodeType)) {
        const options = config.buttons || config.rows || [];
        const normalized = Array.isArray(options) ? options : String(options || '').split(',').filter(Boolean);
        for (const option of normalized) {
          const handle = typeof option === 'string' ? option.trim() : option.id || option.payload || option.title;
          if (handle && !edges.some((edge) => edge.sourceNodeKey === node.nodeKey && edge.sourceHandle === handle)
            && !edges.some((edge) => edge.sourceNodeKey === node.nodeKey && ['next', 'fallback'].includes(edge.sourceHandle))) {
            errors.push({ nodeKey: node.nodeKey, message: `Option "${handle}" needs a branch or fallback.` });
          }
        }
      }
    }
    return errors;
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
    await FlowConnection.destroy({ where: { flowId, [Op.or]: [{ sourceNodeKey: nodeKey }, { targetNodeKey: nodeKey }] } });
    const deleted = await FlowNode.destroy({ where: { flowId, nodeKey } });
    if (!deleted) throw Object.assign(new Error('Flow node not found'), { status: 404 });
    return { deleted: true, nodeKey };
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
        if (node.nodeType === 'end_flow') break;
        node = this.nextNode(flow, node, runContext, result.sourceHandle);
      }
      await run.update({ status: realSendEnabled ? 'completed' : 'simulated', completedAt: new Date(), contextJson: runContext });
      return this.getRun(run.id);
    } catch (error) {
      if (node) await this.incrementNodeStats(node, { errors: 1 });
      await run.update({ status: 'failed', completedAt: new Date(), contextJson: runContext });
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
        await this.log(run, node, 'completed', context, { started: true });
        return {};
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
      await this.log(run, node, 'failed', context, {}, error.message);
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
    if (node.nodeType === 'text_message' || node.nodeType.startsWith('ai_')) {
      response = await whatsappService.sendTextMessage({ to, text, log: false });
    } else if (['button_message', 'interactive_message'].includes(node.nodeType)) {
      const buttons = Array.isArray(config.buttons)
        ? config.buttons
        : String(config.buttons || '').split(',').map((title) => ({ id: title.trim(), title: title.trim() })).filter((item) => item.id);
      response = await whatsappService.sendInteractiveMessage({ to, body: text, footer: config.footer, header: config.header, buttons });
    } else if (node.nodeType === 'list_message' || node.nodeType === 'appointment_booking') {
      const rows = node.nodeType === 'appointment_booking'
        ? (config.slots || []).map((slot) => ({ id: slot.id || slot.value || slot, title: slot.title || slot.label || slot }))
        : (config.rows || []);
      const sections = config.sections?.length
        ? config.sections
        : [{ title: config.sectionTitle || 'Options', rows }];
      response = await whatsappService.sendInteractiveMessage({ to, body: text, footer: config.footer, sections, buttonText: config.buttonText || 'Choose' });
    } else if (node.nodeType === 'whatsapp_flow') {
      response = await whatsappService.sendWhatsAppFlowMessage({
        to, body: text, flowId: config.flowId, flowToken: config.flowToken,
        screen: config.screen, data: config.data || {}
      });
    } else if (node.nodeType === 'image_message') {
      storedType = 'image';
      response = await whatsappService.sendMediaMessage({ to, mediaType: 'image', url: config.mediaUrl, caption: text, log: false });
    } else if (node.nodeType === 'video_message') {
      storedType = 'video';
      response = await whatsappService.sendMediaMessage({ to, mediaType: 'video', url: config.mediaUrl, caption: text, log: false });
    } else if (node.nodeType === 'audio_message') {
      storedType = 'audio';
      response = await whatsappService.sendMediaMessage({ to, mediaType: 'audio', url: config.mediaUrl, log: false });
    } else if (node.nodeType === 'file_document') {
      storedType = 'document';
      response = await whatsappService.sendMediaMessage({ to, mediaType: 'document', url: config.fileUrl, filename: config.fileName, caption: text, log: false });
    } else if (node.nodeType === 'location') {
      storedType = 'location';
      response = await whatsappService.sendLocationMessage({ to, ...config, log: false });
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
      status: 'sent',
      rawPayload: { source: 'flow', flowId: context.flowId || null, nodeKey: node.nodeKey, whatsapp: response }
    });
    return { status: 'completed', response, to, text, nodeType: node.nodeType };
  }

  async handleInboundMessage({
    text, contact, lead, conversation = null, messageType = 'text',
    interactiveType = null, buttonPayload = null, whatsappMessageId = null,
    replyToWhatsappMessageId = null, rawPayload = null
  }) {
    if (!text) return null;
    if (whatsappMessageId) {
      const duplicate = await FlowRun.findOne({ where: { lastWhatsappMessageId: whatsappMessageId } });
      if (duplicate) return this.getRun(duplicate.id);
    }

    const waitingRun = contact?.id
      ? await FlowRun.findOne({
          where: { contactId: contact.id, status: 'waiting', waitingForReply: true },
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
      const startNode = waitingNode.nodeType === 'user_input'
        ? waitingNode
        : this.nextNode(flow, waitingNode, context, branch);
      await waitingRun.update({
        status: 'running',
        waitingForReply: false,
        waitingNodeKey: null,
        lastWhatsappMessageId: whatsappMessageId || waitingRun.lastWhatsappMessageId,
        contextJson: context
      });
      if (!startNode) {
        await waitingRun.update({ status: 'completed', completedAt: new Date() });
        return this.getRun(waitingRun.id);
      }
      return this.executeFlow(flow, context, { run: waitingRun, startNode });
    }

    const flows = await Flow.findAll({ where: { status: 'published' }, include: this.includeBuilder() });
    const normalized = String(text).trim().toLowerCase();
    const flow = flows.find((candidate) => {
      const config = candidate.triggerConfig || {};
      const source = config.source || candidate.triggerType || 'inbound_message';
      const isInteractive = messageType === 'button_reply' || messageType === 'interactive';
      if (source === 'template_button_reply' && !isInteractive) return false;
      if (source === 'interactive_button_reply' && interactiveType !== 'button_reply' && messageType !== 'button_reply') return false;
      if (source === 'list_reply' && interactiveType !== 'list_reply') return false;
      if (source === 'campaign_response' && !replyToWhatsappMessageId) return false;
      const keywords = normalizeKeywords(config.keywords?.length ? config.keywords : candidate.triggerKeywords);
      if (!keywords.length) return ['inbound_message', 'manual'].includes(source);
      const matchType = config.matchType || 'contains';
      return keywords.some((keyword) => {
        const expected = String(keyword).trim().toLowerCase();
        if (matchType === 'exact') return normalized === expected;
        if (matchType === 'starts_with') return normalized.startsWith(expected);
        return normalized.includes(expected);
      });
    });
    if (!flow) return null;
    return this.executeFlow(flow, {
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
    });
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

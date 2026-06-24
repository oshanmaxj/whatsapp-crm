const {
  Contact,
  Conversation,
  ConversationNote,
  Followup,
  Label,
  Lead,
  MessageTemplate,
  User,
  Workflow,
  WorkflowRun,
  WorkflowStep
} = require('../models');
const leadService = require('./lead.service');
const whatsappService = require('./whatsapp.service');

const ACTION_LABELS = {
  send_whatsapp_message: 'Send WhatsApp message',
  add_tag_label: 'Add tag/label',
  assign_agent: 'Assign agent',
  change_lead_status: 'Change lead status',
  create_follow_up: 'Create follow-up',
  add_internal_note: 'Add internal note',
  send_campaign_template: 'Send campaign/template message'
};

function normalizeSteps(steps = []) {
  return steps.map((step, index) => ({
    id: step.id,
    sortOrder: Number(step.sortOrder || index + 1),
    actionType: step.actionType,
    config: step.config || {},
    enabled: step.enabled !== false
  }));
}

function render(text = '', context = {}) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), context);
    return value === undefined || value === null ? '' : String(value);
  });
}

class WorkflowService {
  include() {
    return [
      { model: WorkflowStep, as: 'steps', required: false },
      { model: WorkflowRun, as: 'runs', required: false, limit: 5, order: [['created_at', 'DESC']] },
      { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'], required: false }
    ];
  }

  async list() {
    return Workflow.findAll({
      include: this.include(),
      order: [['created_at', 'DESC'], [{ model: WorkflowStep, as: 'steps' }, 'sort_order', 'ASC']]
    });
  }

  async get(id) {
    const workflow = await Workflow.findByPk(id, {
      include: this.include(),
      order: [[{ model: WorkflowStep, as: 'steps' }, 'sort_order', 'ASC']]
    });
    if (!workflow) {
      const error = new Error('Workflow not found');
      error.status = 404;
      throw error;
    }
    return workflow;
  }

  async create(payload, createdBy) {
    if (!payload.name || !payload.triggerType) {
      const error = new Error('Workflow name and trigger type are required');
      error.status = 400;
      throw error;
    }

    const workflow = await Workflow.create({
      name: payload.name,
      description: payload.description || null,
      triggerType: payload.triggerType,
      enabled: payload.enabled !== false,
      conditions: payload.conditions || {},
      createdBy
    });

    if (Array.isArray(payload.steps)) {
      await WorkflowStep.bulkCreate(normalizeSteps(payload.steps).map((step) => ({ ...step, workflowId: workflow.id })));
    }

    return this.get(workflow.id);
  }

  async update(id, payload) {
    const workflow = await this.get(id);
    await workflow.update({
      name: payload.name ?? workflow.name,
      description: payload.description ?? workflow.description,
      triggerType: payload.triggerType ?? workflow.triggerType,
      enabled: payload.enabled ?? workflow.enabled,
      conditions: payload.conditions ?? workflow.conditions
    });

    if (Array.isArray(payload.steps)) {
      await WorkflowStep.destroy({ where: { workflowId: id } });
      await WorkflowStep.bulkCreate(normalizeSteps(payload.steps).map((step) => ({ ...step, workflowId: id })));
    }

    return this.get(id);
  }

  async remove(id) {
    const workflow = await this.get(id);
    await workflow.destroy();
    return { deleted: true, id };
  }

  async test(id, context = {}) {
    const workflow = await this.get(id);
    const run = await WorkflowRun.create({
      workflowId: workflow.id,
      triggerType: workflow.triggerType,
      status: 'running',
      context
    });

    const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
    const results = [];

    try {
      const steps = [...(workflow.steps || [])].sort((a, b) => a.sortOrder - b.sortOrder).filter((step) => step.enabled);
      for (const step of steps) {
        results.push(await this.executeStep(step, context, realSendEnabled));
      }

      await workflow.update({ lastRunAt: new Date() });
      await run.update({
        status: realSendEnabled ? 'completed' : 'simulated',
        results,
        finishedAt: new Date()
      });
      return this.getRun(run.id);
    } catch (error) {
      await run.update({ status: 'failed', results, errorMessage: error.message, finishedAt: new Date() });
      throw error;
    }
  }

  async getRun(id) {
    return WorkflowRun.findByPk(id, { include: [{ model: Workflow, as: 'workflow' }] });
  }

  async executeStep(step, context, realSendEnabled) {
    const config = step.config || {};
    const result = {
      stepId: step.id,
      actionType: step.actionType,
      actionLabel: ACTION_LABELS[step.actionType] || step.actionType,
      simulated: !realSendEnabled,
      status: 'completed'
    };

    if (step.actionType === 'send_whatsapp_message') {
      const to = config.to || context.phone || context.contact?.phone || context.lead?.phone;
      const text = render(config.message || config.text || '', context);
      if (realSendEnabled && to && text) {
        result.response = await whatsappService.sendTextMessage({ to, text });
      } else {
        result.status = 'simulated';
        result.preview = { to, text };
      }
      return result;
    }

    if (step.actionType === 'send_campaign_template') {
      const template = config.templateId ? await MessageTemplate.findByPk(config.templateId) : null;
      const to = config.to || context.phone || context.contact?.phone || context.lead?.phone;
      const text = render(config.message || template?.body || '', context);
      if (realSendEnabled && to && text) {
        result.response = await whatsappService.sendTextMessage({ to, text });
      } else {
        result.status = 'simulated';
        result.preview = { to, text, templateId: config.templateId || null };
      }
      return result;
    }

    if (step.actionType === 'add_tag_label') {
      if (config.contactId || context.contactId) {
        const contact = await Contact.findByPk(config.contactId || context.contactId);
        if (contact) {
          const tags = Array.isArray(contact.tags) ? contact.tags : [];
          const nextTags = [...new Set([...tags, ...(config.tags || []), config.tag].filter(Boolean))];
          await contact.update({ tags: nextTags });
          result.contactId = contact.id;
          result.tags = nextTags;
        }
      }
      if (config.labelName) {
        const [label] = await Label.findOrCreate({ where: { name: config.labelName }, defaults: { color: config.color || '#25d366' } });
        result.labelId = label.id;
      }
      return result;
    }

    if (step.actionType === 'assign_agent') {
      const leadId = config.leadId || context.leadId;
      const assignedAgentId = config.assignedAgentId || context.assignedAgentId;
      if (leadId && assignedAgentId) {
        result.lead = await leadService.assignLead(leadId, { assignedAgentId, note: 'Assigned by workflow automation' });
      } else {
        result.status = 'simulated';
        result.preview = { leadId, assignedAgentId };
      }
      return result;
    }

    if (step.actionType === 'change_lead_status') {
      const leadId = config.leadId || context.leadId;
      if (leadId && config.status) {
        result.lead = await leadService.updateLead(leadId, { status: config.status });
      } else {
        result.status = 'simulated';
        result.preview = { leadId, status: config.status };
      }
      return result;
    }

    if (step.actionType === 'create_follow_up') {
      const dueDate = config.dueDate || context.followUpDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      result.followup = await Followup.create({
        leadId: config.leadId || context.leadId || null,
        contactId: config.contactId || context.contactId || null,
        assignedTo: config.assignedAgentId || context.assignedAgentId || null,
        dueDate,
        note: render(config.note || 'Workflow follow-up', context),
        priority: config.priority || 'medium'
      });
      return result;
    }

    if (step.actionType === 'add_internal_note') {
      const conversationId = config.conversationId || context.conversationId;
      if (conversationId && await Conversation.findByPk(conversationId)) {
        result.note = await ConversationNote.create({
          conversationId,
          createdBy: context.userId || null,
          type: config.noteType || 'private',
          note: render(config.note || 'Workflow note', context)
        });
      } else {
        result.status = 'simulated';
        result.preview = { conversationId, note: render(config.note || 'Workflow note', context) };
      }
      return result;
    }

    result.status = 'skipped';
    return result;
  }
}

module.exports = new WorkflowService();

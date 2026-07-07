const { NotificationMessageTemplate } = require('../models');

const SUPPORTED_VARIABLES = [
  'student.name', 'student.phone', 'course.name', 'batch.name', 'fee.amount',
  'payment.amount', 'payment.date', 'payment.method', 'installment.no',
  'installment.due_date', 'zoom.link', 'class.date', 'class.time',
  'company.name', 'agent.name'
];

function valueAt(source, path) {
  return path.split('.').reduce((value, part) => value?.[part], source);
}

function renderBody(body, variables = {}) {
  return String(body || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (token, key) => {
    const value = valueAt(variables, key);
    return value === undefined || value === null ? token : String(value);
  });
}

class NotificationTemplateService {
  async list() {
    return NotificationMessageTemplate.findAll({ order: [['title', 'ASC']] });
  }

  async getByKey(key, options = {}) {
    const template = await NotificationMessageTemplate.findOne({ where: { key }, ...options });
    if (!template) throw Object.assign(new Error('Notification message template not found'), { status: 404 });
    return template;
  }

  async update(id, payload = {}) {
    const template = await NotificationMessageTemplate.findByPk(id);
    if (!template) throw Object.assign(new Error('Notification message template not found'), { status: 404 });
    if (payload.channel && !['whatsapp', 'email', 'sms'].includes(payload.channel)) {
      throw Object.assign(new Error('Channel must be whatsapp, email, or sms'), { status: 422 });
    }
    if (payload.body !== undefined && !String(payload.body).trim()) {
      throw Object.assign(new Error('Template body is required'), { status: 422 });
    }
    await template.update({
      title: payload.title === undefined ? template.title : String(payload.title).trim(),
      channel: payload.channel ?? template.channel,
      body: payload.body === undefined ? template.body : String(payload.body),
      isActive: payload.isActive ?? template.isActive
    });
    return template;
  }

  async renderTemplate(templateKey, variables = {}, options = {}) {
    const template = await this.getByKey(templateKey, options);
    if (!template.isActive && !options.allowInactive) {
      throw Object.assign(new Error('Notification message template is inactive'), { status: 409 });
    }
    return renderBody(template.body, variables);
  }

  async preview(key, variables = {}) {
    const template = await this.getByKey(key);
    return {
      key,
      rendered: renderBody(template.body, variables),
      variables: SUPPORTED_VARIABLES
    };
  }
}

const service = new NotificationTemplateService();
service.renderBody = renderBody;
service.SUPPORTED_VARIABLES = SUPPORTED_VARIABLES;
module.exports = service;

const Joi = require('joi');
const { LEAD_STATUSES } = require('../constants/leadStatuses');

const statuses = LEAD_STATUSES.map((status) => status.name);
const sources = ['Facebook Ads', 'WhatsApp Ads', 'Website', 'Instagram', 'TikTok', 'Google Search', 'Referral', 'Organic', 'Manual Entry'];
const priorities = ['low', 'medium', 'high'];
const courses = ['Forex', 'Crypto', 'Stock Market', 'Home Decoration', 'Other'];
const studentTypes = ['New Student', 'Existing Student', 'Returning Student'];

const leadFields = {
  name: Joi.string().max(200).allow('', null).optional(),
  firstName: Joi.string().max(100).allow('', null).optional(),
  lastName: Joi.string().max(100).allow('', null).optional(),
  phone: Joi.string().max(50),
  email: Joi.string().email().max(255).allow('', null).optional(),
  source: Joi.string().valid(...sources).optional(),
  status: Joi.string().valid(...statuses).optional(),
  priority: Joi.string().valid(...priorities).optional(),
  assignedAgentId: Joi.number().integer().positive().allow(null).optional(),
  courseInterested: Joi.string().valid(...courses).allow(null).optional(),
  batchInterested: Joi.string().max(100).allow('', null).optional(),
  budget: Joi.number().precision(2).min(0).allow(null).optional(),
  studentType: Joi.string().valid(...studentTypes).allow(null).optional(),
  notes: Joi.string().allow('', null).optional(),
  followUpDate: Joi.date().iso().allow(null).optional()
};

exports.createLeadSchema = Joi.object({
  ...leadFields,
  phone: leadFields.phone.required(),
  source: leadFields.source.default('Manual Entry'),
  status: leadFields.status.default('New'),
  priority: leadFields.priority.default('medium')
});

exports.updateLeadSchema = Joi.object({
  ...leadFields,
  phone: leadFields.phone.optional()
}).min(1);

exports.assignLeadSchema = Joi.object({
  assignedAgentId: Joi.number().integer().positive().allow(null).required(),
  note: Joi.string().max(255).allow('', null).optional()
});

exports.autoAssignSchema = Joi.object({
  leadIds: Joi.array().items(Joi.number().integer().positive()).optional(),
  limit: Joi.number().integer().min(1).max(100).default(25)
});

exports.updateLeadStatusSchema = Joi.object({
  statusCode: Joi.string().max(80).optional(),
  status: Joi.string().max(100).optional(),
  statusId: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().max(100)).optional(),
  leadStatus: Joi.alternatives().try(
    Joi.string().max(100),
    Joi.object({ code: Joi.string().max(80).optional(), statusCode: Joi.string().max(80).optional(), id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().max(100)).optional() }).or('code', 'statusCode', 'id')
  ).optional(),
  code: Joi.string().max(80).optional(),
  expectedCurrentStatusCode: Joi.string().max(100).optional(),
  source: Joi.string().valid('leads_page', 'chat_workspace').optional()
}).or('statusCode', 'status', 'statusId', 'leadStatus', 'code');

exports.leadOptions = { statuses, sources, priorities, courses, studentTypes };

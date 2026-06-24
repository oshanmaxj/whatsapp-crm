const Joi = require('joi');

exports.createAutoReplySchema = Joi.object({
  trigger: Joi.string().max(255).required(),
  matchType: Joi.string().valid('exact', 'contains', 'regex').default('contains'),
  response: Joi.string().required(),
  active: Joi.boolean().default(true),
  createdBy: Joi.number().integer().positive().optional(),
  updatedBy: Joi.number().integer().positive().optional()
});

exports.updateAutoReplySchema = Joi.object({
  trigger: Joi.string().max(255).optional(),
  matchType: Joi.string().valid('exact', 'contains', 'regex').optional(),
  response: Joi.string().optional(),
  active: Joi.boolean().optional(),
  updatedBy: Joi.number().integer().positive().optional()
});
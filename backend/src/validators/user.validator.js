const Joi = require('joi');

exports.updateUserSchema = Joi.object({
  firstName: Joi.string().max(100).optional(),
  lastName: Joi.string().max(100).optional(),
  phone: Joi.string().max(50).optional(),
  status: Joi.string().valid('active', 'inactive', 'suspended', 'pending').optional(),
  isSystemAdmin: Joi.boolean().optional()
});

exports.assignRolesSchema = Joi.object({
  roles: Joi.array().items(Joi.number().integer().positive()).required()
});
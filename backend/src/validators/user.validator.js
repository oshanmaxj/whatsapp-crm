const Joi = require('joi');

exports.updateUserSchema = Joi.object({
  name: Joi.string().trim().max(220).optional(),
  firstName: Joi.string().max(100).optional(),
  lastName: Joi.string().max(100).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().max(50).optional(),
  roleId: Joi.number().integer().positive().optional(),
  role: Joi.alternatives(Joi.string(), Joi.number()).optional(),
  roles: Joi.array().items(Joi.alternatives(Joi.string(), Joi.number())).optional(),
  status: Joi.string().valid('active', 'inactive', 'suspended', 'pending').optional(),
  receiveAssignmentNotifications: Joi.boolean().optional(),
  isSystemAdmin: Joi.boolean().optional()
});

exports.createUserSchema = Joi.object({
  name: Joi.string().trim().max(220).required(),
  firstName: Joi.string().max(100).optional(),
  lastName: Joi.string().max(100).optional(),
  email: Joi.string().email().required(),
  phone: Joi.string().max(50).allow('', null).optional(),
  password: Joi.string().min(6).required(),
  roleId: Joi.number().integer().positive().optional(),
  role: Joi.alternatives(Joi.string(), Joi.number()).optional(),
  receiveAssignmentNotifications: Joi.boolean().default(true),
  status: Joi.string().valid('active', 'inactive', 'suspended', 'pending').default('active')
}).or('roleId', 'role');

exports.resetPasswordSchema = Joi.object({
  password: Joi.string().min(6).required()
});

exports.assignRolesSchema = Joi.object({
  roles: Joi.array().items(Joi.alternatives(Joi.string(), Joi.number().integer().positive())).required()
});

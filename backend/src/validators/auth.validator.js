const Joi = require('joi');

exports.registerSchema = Joi.object({
  firstName: Joi.string().max(100).required(),
  lastName: Joi.string().max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  phone: Joi.string().max(50).optional()
});

exports.loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

exports.refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

exports.updateMeSchema = Joi.object({
  firstName: Joi.string().max(100).allow('', null).optional(),
  lastName: Joi.string().max(100).allow('', null).optional(),
  phone: Joi.string().max(50).allow('', null).optional()
});

exports.changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required()
});

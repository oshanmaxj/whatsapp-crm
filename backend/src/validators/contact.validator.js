const Joi = require('joi');

const contactFields = {
  firstName: Joi.string().max(100).allow(null, '').optional(),
  lastName: Joi.string().max(100).allow(null, '').optional(),
  phone: Joi.string().max(50),
  whatsappId: Joi.string().max(255).allow(null, '').optional(),
  email: Joi.string().email().max(255).allow(null, '').optional(),
  company: Joi.string().max(150).allow(null, '').optional(),
  status: Joi.string().valid('new', 'active', 'inactive', 'archived').optional(),
  notes: Joi.string().allow(null, '').optional(),
  tags: Joi.array().items(Joi.string().max(100)).default([])
};

exports.createContactSchema = Joi.object({
  ...contactFields,
  phone: contactFields.phone.required(),
  status: contactFields.status.default('new')
});

exports.updateContactSchema = Joi.object({
  ...contactFields,
  phone: contactFields.phone.optional()
}).min(1);

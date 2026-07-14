const Joi = require('joi');

exports.validateBody = (schema, options = {}) => (req, res, next) => {
  const validation = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
  if (validation.error) {
    const error = new Error('Validation failed');
    error.status = options.status || 422;
    if (options.code) error.code = options.code;
    error.details = validation.error.details.map((detail) => ({ message: detail.message, path: detail.path }));
    return next(error);
  }

  req.body = validation.value;
  next();
};

exports.validateRequest = (req) => {
  if (req.validation && req.validation.error) {
    const error = new Error('Validation failed');
    error.status = 422;
    error.details = req.validation.error.details;
    throw error;
  }
};

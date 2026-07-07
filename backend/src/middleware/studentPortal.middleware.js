const studentPortalService = require('../services/studentPortal.service');

exports.authenticate = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      const error = new Error('Student portal authentication is required');
      error.status = 401;
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    const context = await studentPortalService.authenticate(authorization.slice(7));
    req.student = context.student;
    req.studentPaymentAccess = context.paymentAccess;
    next();
  } catch (error) {
    error.status = error.status || 401;
    error.code = error.code || (error.name === 'TokenExpiredError' ? 'AUTH_EXPIRED' : 'AUTH_INVALID');
    next(error);
  }
};

exports.requirePaymentAccess = (req, res, next) => {
  if (req.studentPaymentAccess?.allowed) return next();
  return res.status(403).json({
    success: false,
    code: 'PAYMENT_ACCESS_LIMITED',
    message: req.studentPaymentAccess?.warning || 'Student portal access is limited due to payment status.',
    data: { paymentAccess: req.studentPaymentAccess }
  });
};

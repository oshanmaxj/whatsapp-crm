const { canConfirmPayment } = require('../utils/paymentConfirmationAccess');

module.exports = (req, res, next) => {
  if (canConfirmPayment(req.user)) return next();

  return res.status(403).json({
    success: false,
    message: 'You do not have permission to confirm or reject payments.'
  });
};

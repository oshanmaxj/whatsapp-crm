const ALLOWED_ROLES = new Set(['admin', 'accountant', 'manager']);
const ALLOWED_PERMISSIONS = new Set(['fees.confirm_payment', 'accounting.confirm_income']);

function canConfirmPayment(user) {
  const roles = (user?.roles || []).map((role) => String(role?.name || role).toLowerCase());
  const permissions = user?.permissions || [];
  return Boolean(
    user?.isSystemAdmin ||
    roles.some((role) => ALLOWED_ROLES.has(role)) ||
    permissions.some((permission) => ALLOWED_PERMISSIONS.has(permission))
  );
}

module.exports = { canConfirmPayment };

module.exports = (permission) => (req, res, next) => {
  if (req.user?.isSystemAdmin) return next();
  const permissions = req.user?.permissions || [];
  if (permissions.includes(permission)) return next();
  return res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
};

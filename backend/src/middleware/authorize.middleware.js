exports.adminOnly = (req, res, next) => {
  const user = req.user;
  const roles = (user?.roles || []).map((role) => String(role).toLowerCase());
  if (!user || (!user.isSystemAdmin && !roles.includes('admin'))) {
    const err = new Error('Admin privileges required');
    err.status = 403;
    return next(err);
  }
  next();
};

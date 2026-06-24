exports.adminOnly = (req, res, next) => {
  const user = req.user;
  if (!user || !user.isSystemAdmin) {
    const err = new Error('Admin privileges required');
    err.status = 403;
    return next(err);
  }
  next();
};
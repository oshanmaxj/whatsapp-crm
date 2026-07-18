module.exports = (req, res, next) => {
  if (process.env.SESSION_TIMEOUT_ENABLED !== 'true') return next();
  if (!req.user?.iat) return next();
  const timeoutMinutes = Number(process.env.SESSION_TIMEOUT_MINUTES || 43200);
  const ageSeconds = Math.floor(Date.now() / 1000) - req.user.iat;
  if (ageSeconds > timeoutMinutes * 60) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_EXPIRED',
      message: 'Session expired. Please login again.'
    });
  }
  return next();
};

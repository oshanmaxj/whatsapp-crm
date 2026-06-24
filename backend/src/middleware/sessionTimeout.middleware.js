module.exports = (req, res, next) => {
  if (!req.user?.iat) return next();
  const timeoutMinutes = Number(process.env.SESSION_TIMEOUT_MINUTES || 120);
  const ageSeconds = Math.floor(Date.now() / 1000) - req.user.iat;
  if (ageSeconds > timeoutMinutes * 60) {
    return res.status(401).json({ success: false, message: 'Session expired. Please login again.' });
  }
  return next();
};

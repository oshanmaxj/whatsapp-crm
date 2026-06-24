const buckets = new Map();

module.exports = ({ windowMs = 60000, max = 120 } = {}) => (req, res, next) => {
  const key = req.ip || req.headers['x-forwarded-for'] || 'local';
  const now = Date.now();
  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  res.setHeader('X-RateLimit-Limit', max);
  res.setHeader('X-RateLimit-Remaining', Math.max(max - bucket.count, 0));
  if (bucket.count > max) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please slow down.' });
  }
  return next();
};

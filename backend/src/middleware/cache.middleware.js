const cache = new Map();

function buildKey(req) {
  const userKey = req.user?.id ? `user:${req.user.id}` : 'anonymous';
  return `${userKey}:${req.method}:${req.originalUrl}`;
}

function apiCache({ ttlSeconds = 30 } = {}) {
  return (req, res, next) => {
    if (req.method !== 'GET' || req.headers.authorization === undefined) {
      return next();
    }

    const key = buildKey(req);
    const cached = cache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', `private, max-age=${ttlSeconds}`);
      return res.status(cached.status).json(cached.body);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(key, {
          status: res.statusCode,
          body,
          expiresAt: now + ttlSeconds * 1000
        });
      }
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('Cache-Control', `private, max-age=${ttlSeconds}`);
      return originalJson(body);
    };

    return next();
  };
}

function clearApiCache(req, res, next) {
  if (req.method !== 'GET') {
    cache.clear();
  }
  return next();
}

module.exports = {
  apiCache,
  clearApiCache
};

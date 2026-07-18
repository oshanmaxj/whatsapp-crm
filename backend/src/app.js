const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const routes = require('./routes');
const logger = require('./config/logger');
const { corsOptions } = require('./config/cors');
const errorHandler = require('./middleware/error.middleware');
const auditMiddleware = require('./middleware/audit.middleware');
const { clearApiCache } = require('./middleware/cache.middleware');
const rateLimit = require('./middleware/rateLimit.middleware');

const app = express();
const quietDevelopmentGetPaths = new Set([
  '/api/conversations',
  '/api/chat/unread',
  '/api/agents'
]);

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: process.env.NODE_ENV === 'production'
    ? {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"]
        }
      }
    : false
}));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({
  limit: '30mb',
  verify(req, res, buffer) {
    if (req.originalUrl?.startsWith('/api/webhooks/whatsapp')) req.rawBody = Buffer.from(buffer);
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: logger.stream,
  skip(req, res) {
    return process.env.NODE_ENV === 'development'
      && req.method === 'GET'
      && res.statusCode < 400
      && quietDevelopmentGetPaths.has(req.path);
  }
}));
app.use(rateLimit({ windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60000), max: Number(process.env.API_RATE_LIMIT_MAX || 240) }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  fallthrough: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', process.env.NODE_ENV === 'production' ? 'public, max-age=86400' : 'no-store');
  }
}));

app.use(clearApiCache);
app.use(auditMiddleware);
app.use('/api', routes);

app.use(errorHandler);

module.exports = app;

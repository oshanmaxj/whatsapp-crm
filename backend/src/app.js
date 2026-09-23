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
const defaultJsonParser = express.json({
  limit: '30mb',
  verify(req, res, buffer) {
    if (req.originalUrl?.startsWith('/api/webhooks/whatsapp') || req.originalUrl?.startsWith('/api/webhooks/facebook') || req.originalUrl?.startsWith('/api/webhooks/sms')) req.rawBody = Buffer.from(buffer);
  }
});
app.use((req, res, next) => {
  if (/^\/api\/chat\/conversations\/[^/]+\/interactive$/.test(req.path)) return next();
  return defaultJsonParser(req, res, next);
});
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
// Only these subdirectories of uploads/ are genuinely public (LMS course
// materials, campaign/template header media, template samples). WhatsApp
// message media (uploads/whatsapp/) is deliberately NOT mounted here — it
// may contain a customer's payment proof, and is served only through the
// authenticated GET /api/media/... endpoints (see media.routes.js), which
// enforce conversation access and, once classified as a payment slip, the
// stricter payment-confirmation/payment-slip-review permissions instead.
const publicUploadStaticOptions = {
  fallthrough: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', process.env.NODE_ENV === 'production' ? 'public, max-age=86400' : 'no-store');
  }
};
['lms-materials', 'media', 'template-samples'].forEach((subdir) => {
  app.use(`/uploads/${subdir}`, express.static(path.join(__dirname, '..', 'uploads', subdir), publicUploadStaticOptions));
});

app.use(clearApiCache);
app.use(auditMiddleware);
app.use('/api', routes);

app.use(errorHandler);

module.exports = app;

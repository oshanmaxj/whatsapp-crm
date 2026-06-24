const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const routes = require('./routes');
const logger = require('./config/logger');
const errorHandler = require('./middleware/error.middleware');
const auditMiddleware = require('./middleware/audit.middleware');
const { clearApiCache } = require('./middleware/cache.middleware');
const rateLimit = require('./middleware/rateLimit.middleware');

const app = express();

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

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
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0)) {
      return callback(null, true);
    }
    return callback(new Error('CORS origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', { stream: logger.stream }));
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

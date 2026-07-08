const logger = require('./logger');

const DEFAULT_ALLOWED_ORIGINS = [
  'http://159.69.83.24:3000',
  'http://159.69.83.24',
  'http://localhost:3000'
];

function normalizeOrigin(origin) {
  return String(origin || '').replace(/\/+$/, '');
}

function parseFrontendOrigins() {
  return String(process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter(Boolean);
}

const allowedOrigins = Array.from(new Set([
  ...parseFrontendOrigins(),
  ...DEFAULT_ALLOWED_ORIGINS
]));

function isOriginAllowed(origin) {
  if (!origin) return true;
  return allowedOrigins.includes(normalizeOrigin(origin));
}

function corsOrigin(origin, callback) {
  if (isOriginAllowed(origin)) {
    return callback(null, true);
  }

  logger.warn('cors_origin_rejected', {
    origin,
    allowedOrigins
  });
  return callback(null, false);
}

const corsOptions = {
  origin: corsOrigin,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  credentials: false,
  optionsSuccessStatus: 204
};

module.exports = {
  allowedOrigins,
  corsOptions,
  corsOrigin,
  isOriginAllowed
};

const LEVELS = ['error', 'warn', 'info', 'debug'];
const configuredLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const activeLevelIndex = LEVELS.includes(configuredLevel) ? LEVELS.indexOf(configuredLevel) : LEVELS.indexOf('info');

const SECRET_KEY = /authorization|access[_-]?token|bearer|app[_-]?secret|client[_-]?secret/i;
const SECRET_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\bOAuth\s+[A-Za-z0-9._~+\/-]+=*/gi;
const BINARY_KEY = /base64|binary|buffer|fileData|dataBase64/i;
const DATA_URI = /^data:[^;,]+;base64,/i;
const LONG_BASE64 = /^[A-Za-z0-9+/=\r\n]+$/;

function redact(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (BINARY_KEY.test(key)) return '[REDACTED_BINARY]';
  if (Buffer.isBuffer(value)) return `[BUFFER ${value.length} bytes]`;
  if (typeof value === 'string') {
    if (DATA_URI.test(value) || (value.length > 256 && LONG_BASE64.test(value))) return `[BASE64 ${value.length} chars]`;
    return value.replace(SECRET_VALUE, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

function serialize(value) {
  if (value instanceof Error) {
    return redact({
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code || null
    });
  }

  return redact(value);
}

function write(level, message, metadata) {
  if (LEVELS.indexOf(level) > activeLevelIndex) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString()
  };

  if (metadata !== undefined) {
    entry.metadata = serialize(metadata);
  }

  const output = JSON.stringify(entry);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

module.exports = {
  error: (message, metadata) => write('error', message, metadata),
  warn: (message, metadata) => write('warn', message, metadata),
  info: (message, metadata) => write('info', message, metadata),
  debug: (message, metadata) => write('debug', message, metadata),
  stream: {
    write: (message) => write('info', message.trim())
  }
};
module.exports.redact = redact;

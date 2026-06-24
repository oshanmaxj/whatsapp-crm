const LEVELS = ['error', 'warn', 'info', 'debug'];
const configuredLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const activeLevelIndex = LEVELS.includes(configuredLevel) ? LEVELS.indexOf(configuredLevel) : LEVELS.indexOf('info');

function serialize(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  return value;
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

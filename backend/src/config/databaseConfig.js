const SUPPORTED_DIALECTS = new Set(['postgres', 'mysql', 'mariadb', 'sqlite']);

function dialectFromUrl(value) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch {
    throw new Error('DATABASE_URL is not a valid database URI.');
  }
  const protocol = parsed.protocol.replace(':', '').toLowerCase();
  if (protocol === 'postgresql') return 'postgres';
  if (SUPPORTED_DIALECTS.has(protocol)) return protocol;
  throw new Error(`DATABASE_URL uses unsupported database protocol '${protocol}'.`);
}

function parsePort(value, label = 'DB_PORT') {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  if (!/^\d+$/.test(String(value).trim())) throw new Error(`${label} must be an integer between 1 and 65535.`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535.`);
  }
  return port;
}

function resolveDatabaseConfig(env = process.env) {
  const explicitDialect = String(env.DB_DIALECT || '').trim().toLowerCase() || null;
  const databaseUrl = String(env.DATABASE_URL || '').trim() || null;
  const urlDialect = dialectFromUrl(databaseUrl);
  if (explicitDialect && !SUPPORTED_DIALECTS.has(explicitDialect)) {
    throw new Error(`Unsupported DB_DIALECT '${explicitDialect}'.`);
  }
  if (explicitDialect && urlDialect && explicitDialect !== urlDialect) {
    throw new Error(`Database configuration conflict: DB_DIALECT selects '${explicitDialect}' but DATABASE_URL selects '${urlDialect}'.`);
  }
  const dialect = explicitDialect || urlDialect || 'postgres';
  const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
  const urlHost = parsedUrl?.hostname || null;
  const explicitHost = String(env.DB_HOST || '').trim() || null;
  if (explicitHost && urlHost && explicitHost.toLowerCase() !== urlHost.toLowerCase()) {
    throw new Error('Database configuration conflict: DB_HOST and DATABASE_URL select different hosts.');
  }
  const host = urlHost || explicitHost || 'localhost';
  const defaultPort = dialect === 'postgres' ? 5432 : dialect === 'mysql' || dialect === 'mariadb' ? 3306 : null;
  const urlPort = parsePort(parsedUrl?.port, 'DATABASE_URL port');
  const port = parsePort(env.DB_PORT) ?? urlPort ?? defaultPort;
  const explicitSsl = String(env.DB_SSL || '').trim().toLowerCase();
  if (explicitSsl && !['true', 'false'].includes(explicitSsl)) throw new Error('DB_SSL must be true or false.');
  const sslEnabled = dialect === 'postgres'
    ? (explicitSsl ? explicitSsl === 'true' : !['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase()))
    : false;
  return { dialect, databaseUrl, host, port, sslEnabled };
}

module.exports = { resolveDatabaseConfig, dialectFromUrl, parsePort };

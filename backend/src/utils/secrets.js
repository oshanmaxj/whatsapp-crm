// Shared helpers for secrets that must never silently fall back to a
// hardcoded, publicly-known value once the app is running in production.
// In development/test, a fixed fallback is fine so a fresh checkout runs
// without extra env setup.

const DEV_FALLBACKS = {
  INBOX_CURSOR_SECRET: 'development-inbox-cursor-secret',
  LMS_STUDENT_JWT_SECRET: 'development-student-portal-secret'
};

function requiredSecret(envKey, { fallbackEnvKey } = {}) {
  const value = process.env[envKey] || (fallbackEnvKey ? process.env[fallbackEnvKey] : null);
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envKey} must be set in production — refusing to run with a guessable fallback secret.`);
  }
  return DEV_FALLBACKS[envKey] || `${envKey}-dev-only`;
}

module.exports = { requiredSecret };

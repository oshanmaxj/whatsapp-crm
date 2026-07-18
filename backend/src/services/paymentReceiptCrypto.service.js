const crypto = require('crypto');

function key() {
  const secret = process.env.RECEIPT_TOKEN_ENCRYPTION_KEY
    || process.env.APP_SETTINGS_ENCRYPTION_KEY
    || process.env.JWT_REFRESH_SECRET
    || process.env.JWT_ACCESS_SECRET;
  if (!secret) throw Object.assign(new Error('Receipt token encryption key is not configured'), { code: 'RECEIPT_ENCRYPTION_KEY_MISSING' });
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function createToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptToken(value) {
  const [, iv, tag, encrypted] = String(value || '').split(':');
  if (!iv || !tag || !encrypted) throw Object.assign(new Error('Receipt verification token is invalid'), { code: 'RECEIPT_TOKEN_INVALID' });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { createToken, hashToken, encryptToken, decryptToken };

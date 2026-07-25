const crypto = require('crypto');
function key() {
  const raw = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  if (!raw) throw Object.assign(new Error('AI provider encryption is not configured. Contact the system administrator.'), {
    code: 'AI_ENCRYPTION_KEY_REQUIRED', status: 503, exposeMessage: true
  });
  if (Buffer.byteLength(raw, 'utf8') < 32) throw Object.assign(new Error('AI provider encryption configuration is invalid. Contact the system administrator.'), {
    code: 'AI_ENCRYPTION_KEY_INVALID', status: 503, exposeMessage: true
  });
  return crypto.createHash('sha256').update(raw).digest();
}
exports.assertConfigured = () => { key(); return true; };
exports.encrypt = (value) => {
  if (!String(value || '').trim()) throw Object.assign(new Error('API key is required.'), {
    status: 422, code: 'VALIDATION_FAILED', errors: { apiKey: 'API key is required.' }
  });
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { encryptedApiKey: encrypted.toString('base64'), keyIv: iv.toString('base64'), keyTag: cipher.getAuthTag().toString('base64') };
};
exports.decrypt = (row) => {
  if (!row?.encryptedApiKey || !row?.keyIv || !row?.keyTag) throw Object.assign(new Error('The stored provider key is incomplete and must be replaced.'), {
    code: 'AI_PROVIDER_KEY_INVALID', status: 422
  });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(row.keyIv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.keyTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.encryptedApiKey, 'base64')), decipher.final()]).toString('utf8');
};

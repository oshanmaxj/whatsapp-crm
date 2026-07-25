const crypto = require('crypto');
function key() {
  const raw = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  if (!raw) throw Object.assign(new Error('AI provider encryption is not configured.'), { code: 'AI_ENCRYPTION_KEY_REQUIRED', status: 503 });
  return crypto.createHash('sha256').update(raw).digest();
}
exports.encrypt = (value) => {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { encryptedApiKey: encrypted.toString('base64'), keyIv: iv.toString('base64'), keyTag: cipher.getAuthTag().toString('base64') };
};
exports.decrypt = (row) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(row.keyIv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.keyTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.encryptedApiKey, 'base64')), decipher.final()]).toString('utf8');
};

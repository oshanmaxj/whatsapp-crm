function envValue(name, fallback = '') {
  const value = process.env[name];
  if (value == null) return fallback;
  return String(value).trim();
}

module.exports = {
  accessToken: envValue('WHATSAPP_ACCESS_TOKEN'),
  phoneNumberId: envValue('WHATSAPP_PHONE_NUMBER_ID'),
  verifyToken: envValue('WHATSAPP_VERIFY_TOKEN'),
  apiVersion: envValue('WHATSAPP_API_VERSION', 'v17.0'),
  apiBaseUrl: envValue('WHATSAPP_API_BASE_URL', 'https://graph.facebook.com')
};

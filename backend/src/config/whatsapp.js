module.exports = {
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  apiVersion: process.env.WHATSAPP_API_VERSION || 'v17.0',
  apiBaseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com'
};

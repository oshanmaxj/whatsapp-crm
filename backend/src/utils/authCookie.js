const COOKIE_NAME = process.env.AUTH_REFRESH_COOKIE_NAME || 'crm_refresh_token';

function cookieOptions() {
  const configured = String(process.env.AUTH_COOKIE_SAME_SITE || 'lax').toLowerCase();
  const sameSite = ['lax', 'strict', 'none'].includes(configured) ? configured : 'lax';
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    path: '/api/auth',
    maxAge: Number(process.env.CRM_SESSION_DAYS || 30) * 86400000,
    ...(process.env.AUTH_COOKIE_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {})
  };
}

function readCookie(req, name = COOKIE_NAME) {
  for (const cookie of String(req.headers?.cookie || '').split(';')) {
    const separator = cookie.indexOf('=');
    if (separator >= 0 && cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return null;
}

function setRefreshCookie(res, token) { res.cookie(COOKIE_NAME, token, cookieOptions()); }
function clearRefreshCookie(res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

module.exports = { COOKIE_NAME, clearRefreshCookie, cookieOptions, readCookie, setRefreshCookie };

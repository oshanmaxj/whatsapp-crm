module.exports = {
  accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'jwt_access_secret',
  accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  refreshTokenSecret: process.env.JWT_REFRESH_SECRET || 'jwt_refresh_secret',
  refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES || '30d'
};

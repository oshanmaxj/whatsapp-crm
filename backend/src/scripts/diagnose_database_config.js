require('../config/loadEnv');
const sequelize = require('../config/database');

console.log(JSON.stringify(sequelize.resolvedConfig, null, 2));

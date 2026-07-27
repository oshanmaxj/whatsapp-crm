const path = require('path');
const dotenv = require('dotenv');

const backendEnvPath = path.resolve(__dirname, '..', '..', '.env');
const result = dotenv.config({ path: backendEnvPath, override: false });

if (result.error && result.error.code !== 'ENOENT') throw result.error;

module.exports = { backendEnvPath };

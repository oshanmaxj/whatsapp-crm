module.exports = {
  apps: [{
    name: 'whatsapp-crm-api',
    script: 'src/server.js',
    cwd: __dirname,
    instances: Number(process.env.API_INSTANCES || 1),
    exec_mode: 'cluster',
    autorestart: true,
    kill_timeout: 10000,
    listen_timeout: 10000,
    env: {
      NODE_ENV: 'production',
      QUEUE_WORKER_ENABLED: 'true',
      QUEUE_PROCESSING_LEASE_MS: '300000',
      QUEUE_WORKER_INTERVAL_MS: '15000',
      QUEUE_RATE_LIMIT_PER_TICK: '5'
    }
  }]
};

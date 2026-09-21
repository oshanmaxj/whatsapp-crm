require('./config/loadEnv');

const validateEnv = require('./config/validateEnv');
validateEnv();

const http = require('http');
const app = require('./app');
const logger = require('./config/logger');
const initSocket = require('./sockets/socket');
const { sequelize } = require('./models');
const messageQueueService = require('./services/messageQueue.service');
const paymentSlipQueueService = require('./services/paymentSlipQueue.service');
const automationService = require('./services/automation.service');
const flowService = require('./services/flow.service');
const pipelineService = require('./services/pipeline.service');
const reminderSequenceService = require('./services/reminderSequence.service');
const smsCampaignWorkerService = require('./services/smsCampaignWorker.service');
const automationSchedulerService = require('./services/automationScheduler.service');
const { isMissingTableError } = require('./utils/databaseError');
const { ensureUnifiedLeadStatuses } = require('./services/unifiedLeadStatuses.service');

const PORT = process.env.PORT || 4000;

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', error);
  process.exit(1);
});

const startServer = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.getQueryInterface().describeTable('birthday_wishes').catch((error) => {
      if (!isMissingTableError(error, 'birthday_wishes')) throw error;
      logger.warn('birthday_wishes_table_missing', {
        action: 'Run npm run migrate from the backend directory'
      });
    });
    if (process.env.DB_SYNC_ALTER === 'true') {
      await sequelize.sync({ alter: true });
      logger.warn('sequelize_sync_alter_enabled');
    }
    await ensureUnifiedLeadStatuses();
    await automationService.ensureDefaults();
    logger.info('database_connection_established');

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
      logger.info('server_started', { port: PORT });
    });
    if (process.env.QUEUE_WORKER_ENABLED !== 'false') messageQueueService.start();
    else logger.warn('queue_worker_disabled', { reason: 'QUEUE_WORKER_ENABLED=false' });
    paymentSlipQueueService.start();
    flowService.start();
    pipelineService.start();
    reminderSequenceService.start();
    if (process.env.SMS_CAMPAIGN_WORKER_ENABLED !== 'false') smsCampaignWorkerService.start();
    else logger.warn('sms_campaign_worker_disabled', { reason: 'SMS_CAMPAIGN_WORKER_ENABLED=false' });
    // Fail-closed by design: this must default to OFF, not merely "off when
    // explicitly disabled" — see automationScheduler.service.js incident
    // notes. Only an explicit AUTOMATION_SCHEDULER_ENABLED=true starts it.
    if (process.env.AUTOMATION_SCHEDULER_ENABLED === 'true') await automationSchedulerService.start();
    else logger.warn('automation_scheduler_disabled', { reason: 'AUTOMATION_SCHEDULER_ENABLED is not "true"' });
  } catch (error) {
    logger.error('server_start_failed', error);
    process.exit(1);
  }
};

startServer();

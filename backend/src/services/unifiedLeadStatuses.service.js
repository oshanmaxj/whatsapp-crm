const { sequelize, LeadStatus } = require('../models');
const logger = require('../config/logger');
const { LEAD_STATUSES, LEAD_STATUS_BY_CODE, normalizeLeadStatusCode } = require('../constants/leadStatuses');

const LOCK_KEY = 'whatsapp_crm_unified_lead_statuses_v1';

function normalized(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function attributesFor(definition, index) {
  return {
    name: definition.name,
    code: definition.code,
    description: `${definition.name} lead status`,
    displayOrder: index + 1,
    active: true,
    isClosed: ['ignore', 'registered', 'lost'].includes(definition.code),
    isWon: definition.code === 'registered',
    isLost: definition.code === 'lost',
    color: definition.color
  };
}

function conflict(definition, rows) {
  return Object.assign(new Error(`Conflicting logical rows exist for unified lead status ${definition.code}. Review and remap references before normalization.`), {
    code: 'UNIFIED_LEAD_STATUS_CONFLICT',
    status: 409,
    details: { statusCode: definition.code, rowIds: rows.map((row) => row.id) }
  });
}

function createUnifiedLeadStatusEnsurer(dependencies = {}) {
  const db = dependencies.sequelize || sequelize;
  const Status = dependencies.LeadStatus || LeadStatus;
  const log = dependencies.logger || logger;

  return async function ensureUnifiedLeadStatuses({ transaction: suppliedTransaction } = {}) {
    log.info('unified_lead_statuses_check_started');

    const normalize = async (transaction) => {
      if (db.getDialect?.() === 'postgres') {
        await db.query('SELECT pg_advisory_xact_lock(hashtext(:lockKey))', {
          replacements: { lockKey: LOCK_KEY }, transaction
        });
      }

      const rows = await Status.findAll({
        transaction,
        lock: transaction?.LOCK?.UPDATE,
        paranoid: false,
        order: [['id', 'ASC']]
      });
      const finalRows = [];

      for (const row of rows) {
        const rowCode = normalizeLeadStatusCode(row.code);
        const nameDefinition = LEAD_STATUSES.find((definition) => normalized(row.name) === normalized(definition.name));
        if (LEAD_STATUS_BY_CODE[rowCode] && nameDefinition && rowCode !== nameDefinition.code) {
          throw conflict(nameDefinition, [row]);
        }
      }

      for (let index = 0; index < LEAD_STATUSES.length; index += 1) {
        const definition = LEAD_STATUSES[index];
        const codeMatches = rows.filter((row) => normalized(row.code) === definition.code);
        const nameMatches = rows.filter((row) => {
          const rowCode = normalizeLeadStatusCode(row.code);
          return normalized(row.name) === normalized(definition.name)
            && (!LEAD_STATUS_BY_CODE[rowCode] || rowCode === definition.code);
        });
        const logicalMatches = Array.from(new Map([...codeMatches, ...nameMatches].map((row) => [String(row.id), row])).values());
        if (logicalMatches.length > 1) throw conflict(definition, logicalMatches);

        const values = attributesFor(definition, index);
        let status = logicalMatches[0] || null;
        if (!status) {
          status = await Status.create(values, { transaction });
          rows.push(status);
          log.info('unified_lead_status_created', { statusId: status.id, statusCode: definition.code });
        } else {
          const wasDeleted = Boolean(status.deletedAt);
          if (wasDeleted && typeof status.restore === 'function') await status.restore({ transaction });
          const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => {
            if (['name', 'code'].includes(key)) return String(status[key] || '').trim() !== String(value);
            return status[key] !== value;
          }));
          if (Object.keys(changes).length || wasDeleted) {
            await status.update(changes, { transaction });
            log.info('unified_lead_status_updated', { statusId: status.id, statusCode: definition.code, fields: Object.keys(changes) });
          } else {
            log.info('unified_lead_status_reused', { statusId: status.id, statusCode: definition.code });
          }
        }
        finalRows.push(status);
      }
      return finalRows;
    };

    try {
      return suppliedTransaction ? await normalize(suppliedTransaction) : await db.transaction(normalize);
    } catch (error) {
      log.error('unified_lead_status_check_failed', { code: error.code, message: error.message });
      throw error;
    }
  };
}

const ensureUnifiedLeadStatuses = createUnifiedLeadStatusEnsurer();

module.exports = { ensureUnifiedLeadStatuses, createUnifiedLeadStatusEnsurer, normalized };

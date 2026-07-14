const unified = [
  ['New', 'new', 1, '#2196f3', false, false, false],
  ['Contacted', 'contacted', 2, '#607d8b', false, false, false],
  ['Interested', 'interested', 3, '#00a884', false, false, false],
  ['Ignore', 'ignore', 4, '#9e9e9e', true, false, false],
  ['Agreed', 'agreed', 5, '#f57c00', false, false, false],
  ['Registered', 'registered', 6, '#43a047', true, true, false],
  ['Lost', 'lost', 7, '#d32f2f', true, false, true]
];

const aliases = {
  new: 'new', 'new lead': 'new', contacted: 'contacted', interested: 'interested',
  'seminar invited': 'interested', 'seminar joined': 'interested',
  'follow up required': 'contacted', 'followup required': 'contacted',
  'payment pending': 'agreed', agreed: 'agreed',
  registered: 'registered', converted: 'registered', 'converted to student': 'registered',
  ignore: 'ignore', 'not interested': 'ignore', lost: 'lost'
};
const unifiedCodes = unified.map(([, code]) => `'${code}'`).join(',');

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function add(q, table, column, definition, transaction) {
  const columns = await q.describeTable(table, { transaction });
  if (!columns[column]) await q.addColumn(table, column, definition, { transaction });
}

async function leadReferenceCount(q, statusId, transaction) {
  const [rows] = await q.sequelize.query(
    'SELECT COUNT(*) AS count FROM leads WHERE status_id=:statusId',
    { replacements: { statusId }, transaction }
  );
  return Number(rows[0]?.count || 0);
}

function mergedName(row) {
  const suffix = ` [merged ${row.id}]`;
  const base = String(row.name || 'Lead status').trim().slice(0, Math.max(1, 100 - suffix.length));
  return `${base}${suffix}`;
}

module.exports = {
  async up(q, S) {
    return q.sequelize.transaction(async (transaction) => {
      if (q.sequelize.getDialect() === 'postgres') {
        await q.sequelize.query(
          "SELECT pg_advisory_xact_lock(hashtext('whatsapp_crm_unified_lead_statuses_v1'))",
          { transaction }
        );
      }

      await add(q, 'leads', 'registered_at', { type: S.DATE, allowNull: true }, transaction);
      const canonical = {};
      const [preflightRows] = await q.sequelize.query(
        'SELECT id,name,code FROM lead_status ORDER BY id FOR UPDATE',
        { transaction }
      );
      for (const row of preflightRows) {
        const codeTarget = aliases[normalized(row.code)];
        const nameTarget = aliases[normalized(row.name)];
        if (codeTarget && nameTarget && codeTarget !== nameTarget) {
          throw new Error(`Lead status ${row.id} has conflicting code and name mappings (${codeTarget}/${nameTarget}); review it before normalization.`);
        }
      }

      for (const [name, code, displayOrder, color, isClosed, isWon, isLost] of unified) {
        let [rows] = await q.sequelize.query(
          `SELECT id,name,code,deleted_at
             FROM lead_status
            WHERE lower(trim(code))=:code
               OR (lower(trim(name))=lower(trim(:name))
                   AND (code IS NULL OR trim(code)='' OR lower(trim(code)) NOT IN (${unifiedCodes})))
            ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END,
                     CASE WHEN lower(trim(code))=:code THEN 0 ELSE 1 END,
                     id
            FOR UPDATE`,
          { replacements: { name, code }, transaction }
        );

        if (!rows[0]) {
          await q.bulkInsert('lead_status', [{
            name, description: `${name} lead status`, code, display_order: displayOrder,
            active: true, is_closed: isClosed, is_won: isWon, is_lost: isLost, color,
            created_at: new Date(), updated_at: new Date()
          }], { transaction });
          [rows] = await q.sequelize.query(
            'SELECT id,name,code,deleted_at FROM lead_status WHERE lower(trim(code))=:code FOR UPDATE',
            { replacements: { code }, transaction }
          );
        }

        const primary = rows[0];
        for (const duplicate of rows.slice(1)) {
          await q.bulkUpdate('leads', { status_id: primary.id, stage: code }, { status_id: duplicate.id }, { transaction });
          const remainingReferences = await leadReferenceCount(q, duplicate.id, transaction);
          if (remainingReferences !== 0) {
            throw new Error(`Lead status ${duplicate.id} still has ${remainingReferences} lead references after remap; refusing cleanup.`);
          }
          await q.bulkUpdate('lead_status', {
            name: mergedName(duplicate), code: null, active: false, updated_at: new Date()
          }, { id: duplicate.id }, { transaction });
        }

        await q.bulkUpdate('lead_status', {
          name, code, display_order: displayOrder, active: true, is_closed: isClosed,
          is_won: isWon, is_lost: isLost, color, deleted_at: null, updated_at: new Date()
        }, { id: primary.id }, { transaction });
        canonical[code] = primary.id;
      }

      const [statuses] = await q.sequelize.query(
        'SELECT id,name,code,active FROM lead_status ORDER BY id FOR UPDATE',
        { transaction }
      );
      for (const status of statuses) {
        const targetCode = aliases[normalized(status.code)] || aliases[normalized(status.name)];
        if (!targetCode) {
          // Preserve custom and historical pipeline statuses. Only known aliases
          // are safe to consolidate automatically.
          continue;
        }

        const targetId = canonical[targetCode];
        if (String(status.id) !== String(targetId)) {
          await q.bulkUpdate('leads', { status_id: targetId, stage: targetCode }, { status_id: status.id }, { transaction });
          const remainingReferences = await leadReferenceCount(q, status.id, transaction);
          if (remainingReferences !== 0) {
            throw new Error(`Lead status ${status.id} still has ${remainingReferences} lead references after remap; refusing deactivation.`);
          }
          await q.bulkUpdate('lead_status', {
            name: mergedName(status), code: null, active: false, updated_at: new Date()
          }, { id: status.id }, { transaction });
        } else {
          await q.bulkUpdate('leads', { stage: targetCode }, { status_id: status.id }, { transaction });
        }
      }

      await q.sequelize.query(
        'UPDATE leads SET registered_at=COALESCE(registered_at,converted_at,updated_at) WHERE status_id=:id',
        { replacements: { id: canonical.registered }, transaction }
      );
      for (const [columns, name] of [
        [['updated_at'], 'leads_updated_at_idx'],
        [['registered_at'], 'leads_registered_at_idx'],
        [['status_id', 'created_at'], 'leads_status_created_idx'],
        [['owner_id', 'created_at'], 'leads_owner_created_idx']
      ]) {
        const indexes = await q.showIndex('leads', { transaction });
        if (!indexes.some((index) => index.name === name)) {
          await q.addIndex('leads', columns, { name, transaction });
        }
      }
    });
  },
  async down() {}
};

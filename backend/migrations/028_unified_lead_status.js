const unified = [
  ['New', 'new', 1, '#2196f3', false, false, false],
  ['Contacted', 'contacted', 2, '#607d8b', false, false, false],
  ['Interested', 'interested', 3, '#00a884', false, false, false],
  ['Ignore', 'ignore', 4, '#9e9e9e', true, false, false],
  ['Agreed', 'agreed', 5, '#f57c00', false, false, false],
  ['Registered', 'registered', 6, '#43a047', true, true, false],
  ['Lost', 'lost', 7, '#d32f2f', true, false, true]
];
const mapping = {
  'new lead': 'new', new: 'new', contacted: 'contacted', interested: 'interested',
  'seminar invited': 'interested', 'seminar joined': 'interested', 'follow-up required': 'contacted',
  'payment pending': 'agreed', registered: 'registered', 'converted to student': 'registered',
  converted: 'registered', 'not interested': 'ignore', ignore: 'ignore', agreed: 'agreed', lost: 'lost'
};

async function add(q, table, column, definition) { const columns = await q.describeTable(table); if (!columns[column]) await q.addColumn(table, column, definition); }

module.exports = {
  async up(q, S) {
    await add(q, 'leads', 'registered_at', { type: S.DATE, allowNull: true });
    const canonical = {};
    for (const [name, code, displayOrder, color, isClosed, isWon, isLost] of unified) {
      let [rows] = await q.sequelize.query('SELECT id FROM lead_status WHERE lower(name)=lower(:name) LIMIT 1', { replacements: { name } });
      if (!rows[0]) {
        await q.bulkInsert('lead_status', [{ name, description: `${name} lead status`, code: null, display_order: displayOrder, active: true, is_closed: isClosed, is_won: isWon, is_lost: isLost, color, created_at: new Date(), updated_at: new Date() }]);
        [rows] = await q.sequelize.query('SELECT id FROM lead_status WHERE lower(name)=lower(:name) LIMIT 1', { replacements: { name } });
      }
      await q.sequelize.query('UPDATE lead_status SET code=NULL WHERE code=:code AND id<>:id', { replacements: { code, id: rows[0].id } });
      await q.bulkUpdate('lead_status', { name, code, display_order: displayOrder, active: true, is_closed: isClosed, is_won: isWon, is_lost: isLost, color, updated_at: new Date() }, { id: rows[0].id });
      canonical[code] = rows[0].id;
    }
    const [statuses] = await q.sequelize.query('SELECT id,name,code FROM lead_status');
    for (const status of statuses) {
      const targetCode = mapping[String(status.name || '').toLowerCase()] || mapping[String(status.code || '').toLowerCase()];
      if (!targetCode) { await q.bulkUpdate('lead_status', { active: false }, { id: status.id }); continue; }
      const targetId = canonical[targetCode];
      if (String(status.id) !== String(targetId)) {
        await q.bulkUpdate('leads', { status_id: targetId, stage: targetCode }, { status_id: status.id });
        await q.bulkUpdate('lead_status', { active: false }, { id: status.id });
      } else {
        await q.bulkUpdate('leads', { stage: targetCode }, { status_id: status.id });
      }
    }
    await q.sequelize.query("UPDATE leads SET registered_at=COALESCE(registered_at,converted_at,updated_at) WHERE status_id=:id", { replacements: { id: canonical.registered } });
    for (const [columns, name] of [[['updated_at'],'leads_updated_at_idx'],[['registered_at'],'leads_registered_at_idx'],[['status_id','created_at'],'leads_status_created_idx'],[['owner_id','created_at'],'leads_owner_created_idx']]) await q.addIndex('leads', columns, { name }).catch(() => {});
  },
  async down() {}
};

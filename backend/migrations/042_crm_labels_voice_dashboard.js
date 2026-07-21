async function hasIndex(queryInterface, table, name) {
  return (await queryInterface.showIndex(table).catch(() => [])).some((item) => item.name === name);
}
async function addIndex(queryInterface, table, fields, name, transaction) {
  if (!(await hasIndex(queryInterface, table, name))) await queryInterface.addIndex(table, fields, { name, transaction });
}
module.exports = {
  async up(queryInterface, Sequelize) {
    const permissions = [
      'dashboard.view_own', 'dashboard.view_team', 'dashboard.view_all', 'dashboard.view_financial',
      'dashboard.view_agent_ranking', 'dashboard.configure_widgets', 'labels.create', 'labels.assign',
      'labels.remove', 'voice.send', 'templates.send'
    ];
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const code of permissions) {
        await queryInterface.sequelize.query(`INSERT INTO permissions (code, name, description, created_at, updated_at) SELECT :code, :name, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = :code)`, { replacements: { code, name: code, description: `CRM permission: ${code}` }, transaction });
        await queryInterface.sequelize.query('UPDATE permissions SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE code = :code AND deleted_at IS NOT NULL', { replacements: { code }, transaction });
      }
      const grant = async (roleNames, codes) => queryInterface.sequelize.query(`INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, p.id, CURRENT_TIMESTAMP FROM roles r CROSS JOIN permissions p WHERE LOWER(r.name) IN (:roles) AND p.code IN (:codes) AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)`, { replacements: { roles: roleNames, codes }, transaction });
      await grant(['admin'], permissions);
      await grant(['manager'], ['dashboard.view_team', 'dashboard.view_agent_ranking', 'labels.assign', 'labels.remove', 'voice.send', 'templates.send']);
      await grant(['agent'], ['dashboard.view_own', 'dashboard.view_agent_ranking', 'labels.assign', 'labels.remove', 'voice.send', 'templates.send']);
      await grant(['accountant'], ['dashboard.view_own', 'dashboard.view_financial']);
      await queryInterface.sequelize.query(`INSERT INTO role_permissions (role_id, permission_id, granted_at)
        SELECT DISTINCT existing.role_id, target.id, CURRENT_TIMESTAMP FROM role_permissions existing
        JOIN permissions current_permission ON current_permission.id = existing.permission_id AND current_permission.code = 'dashboard.view'
        JOIN permissions target ON target.code = 'dashboard.view_own'
        WHERE NOT EXISTS (SELECT 1 FROM role_permissions linked WHERE linked.role_id = existing.role_id AND linked.permission_id = target.id)`, { transaction });
      await queryInterface.sequelize.query(`INSERT INTO role_permissions (role_id, permission_id, granted_at)
        SELECT DISTINCT existing.role_id, target.id, CURRENT_TIMESTAMP FROM role_permissions existing
        JOIN permissions current_permission ON current_permission.id = existing.permission_id AND current_permission.code IN ('inbox.edit','inbox.send')
        JOIN permissions target ON (current_permission.code = 'inbox.edit' AND target.code IN ('labels.assign','labels.remove')) OR (current_permission.code = 'inbox.send' AND target.code IN ('voice.send','templates.send'))
        WHERE NOT EXISTS (SELECT 1 FROM role_permissions linked WHERE linked.role_id = existing.role_id AND linked.permission_id = target.id)`, { transaction });
      await addIndex(queryInterface, 'conversation_labels', ['label_id', 'conversation_id'], 'conversation_labels_label_conversation_idx', transaction);
      await addIndex(queryInterface, 'conversation_labels', ['conversation_id', 'assigned_at'], 'conversation_labels_conversation_assigned_idx', transaction);
      await addIndex(queryInterface, 'messages', ['sent_by_user_id', 'created_at'], 'messages_sender_created_idx', transaction);
      await addIndex(queryInterface, 'followups', ['assigned_to', 'status', 'due_date'], 'followups_assignee_status_due_idx', transaction);
      await addIndex(queryInterface, 'leads', ['owner_id', 'converted_at'], 'leads_owner_converted_idx', transaction);
      if (queryInterface.sequelize.getDialect?.() === 'postgres') {
        const [duplicates] = await queryInterface.sequelize.query('SELECT lower(btrim(name)) AS normalized_name FROM labels GROUP BY lower(btrim(name)) HAVING COUNT(*) > 1 LIMIT 1', { transaction });
        if (!duplicates.length) await queryInterface.sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS labels_normalized_name_unique_idx ON labels (lower(btrim(name)))', { transaction });
      }
    });
  },
  async down() {}
};

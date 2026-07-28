'use strict';

const LOCK = 530054;
const AGENT_ROLE_NAMES = ['agent', 'call center agent', 'call-center agent'];
const FORBIDDEN_AGENT_PERMISSIONS = [
  'call_center.supervisor_dashboard',
  'call_center.view_all_agents',
  'call_center.view_live_calls',
  'call_center.view_all_history',
  'call_center.view_performance',
  'call_queue.view_team',
  'call_queue.manage_team',
  'call_queue.configure'
];

async function operation(name, callback) {
  console.log(`[054_repair_call_center_agent_permissions] ${name}`);
  try { return await callback(); } catch (error) { error.migrationOperation = name; throw error; }
}
const query = (q, sql, transaction, replacements = {}) =>
  q.sequelize.query(sql, { replacements, transaction });

async function columns(q, table, transaction) {
  const [rows] = await operation(`inspect ${table}`, () => query(q,
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name=:table`,
    transaction, { table }));
  return new Set(rows.map((row) => row.column_name));
}

module.exports = {
  async up(q) {
    return q.sequelize.transaction(async (transaction) => {
      await operation('acquire advisory migration lock', () =>
        query(q, 'SELECT pg_advisory_xact_lock(:lock)', transaction, { lock: LOCK }));
      const roleColumns = await columns(q, 'roles', transaction);
      const permissionColumns = await columns(q, 'permissions', transaction);
      const mappingColumns = await columns(q, 'role_permissions', transaction);
      if (!roleColumns.has('id') || !roleColumns.has('name')) throw new Error('Preflight failed: canonical roles schema is missing.');
      if (!permissionColumns.has('id') || !permissionColumns.has('code')) throw new Error('Preflight failed: canonical permissions schema is missing.');
      if (!mappingColumns.has('role_id') || !mappingColumns.has('permission_id')) throw new Error('Preflight failed: canonical role_permissions schema is missing.');

      const replacements = { agentRoleNames: AGENT_ROLE_NAMES, forbiddenAgentPermissions: FORBIDDEN_AGENT_PERMISSIONS };
      const roleActive = roleColumns.has('deleted_at') ? 'AND r.deleted_at IS NULL' : '';
      const permissionActive = permissionColumns.has('deleted_at') ? 'AND p.deleted_at IS NULL' : '';
      const selectSql = `SELECT r.id AS role_id,r.name AS role_name,p.code AS permission_code
        FROM role_permissions rp
        JOIN roles r ON r.id=rp.role_id
        JOIN permissions p ON p.id=rp.permission_id
        WHERE LOWER(r.name) IN (:agentRoleNames)
          ${roleActive} ${permissionActive}
          AND p.code IN (:forbiddenAgentPermissions)
        ORDER BY r.id,p.code`;
      const [before] = await operation('log incorrect grants before repair', () =>
        query(q, selectSql, transaction, replacements));
      console.log('[054_repair_call_center_agent_permissions] rows before repair', before);

      await operation('remove supervisor grants from canonical agent roles', () => query(q,
        `DELETE FROM role_permissions rp
          USING roles r,permissions p
          WHERE rp.role_id=r.id AND rp.permission_id=p.id
            AND LOWER(r.name) IN (:agentRoleNames)
            ${roleActive} ${permissionActive}
            AND p.code IN (:forbiddenAgentPermissions)`,
        transaction, replacements));

      const [after] = await operation('log incorrect grants after repair', () =>
        query(q, selectSql, transaction, replacements));
      console.log('[054_repair_call_center_agent_permissions] rows after repair', after);
      if (after.length) throw new Error('Call Center agent permission repair did not remove every forbidden grant.');
    });
  },
  async down() {
    console.log('[054_repair_call_center_agent_permissions] down is intentionally a no-op; unsafe grants are not restored.');
  }
};

module.exports.constants = { AGENT_ROLE_NAMES, FORBIDDEN_AGENT_PERMISSIONS };

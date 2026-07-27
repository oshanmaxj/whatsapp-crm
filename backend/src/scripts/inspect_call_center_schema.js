require('../config/loadEnv');
const sequelize = require('../config/database');
const models = require('../models');

(async () => {
  try {
    const [columns] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'conversation_assignment_history'
        AND column_name IN ('changed_by_user_id', 'actor_type', 'source')
      ORDER BY column_name
    `);
    const [foreignKeys] = await sequelize.query(`
      SELECT
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = current_schema()
        AND tc.table_name = 'conversation_assignment_history'
        AND kcu.column_name = 'changed_by_user_id'
    `);
    const user = await models.User.findByPk(4, { attributes: ['id', 'status'], raw: true });
    const attributes = models.ConversationAssignmentHistory.rawAttributes;
    const model = ['changedByUserId', 'actorType', 'source'].map(name => ({
      attribute: name,
      field: attributes[name].field,
      allowNull: attributes[name].allowNull,
      defaultValue: attributes[name].defaultValue ?? null,
      type: attributes[name].type.toString()
    }));
    console.log(JSON.stringify({
      table: models.ConversationAssignmentHistory.getTableName(),
      columns,
      foreignKeys,
      authenticatedUser4: user ? { exists: true, id: user.id, status: user.status } : { exists: false },
      model
    }, null, 2));
  } catch (error) {
    const original = error.original || error.parent || error;
    console.error(JSON.stringify({
      message: original.message || error.message,
      sqlState: original.code || null,
      table: original.table || null,
      column: original.column || null,
      constraint: original.constraint || null
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();

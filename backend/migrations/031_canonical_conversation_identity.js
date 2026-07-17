async function columnExists(queryInterface, table, column, transaction) {
  const columns = await queryInterface.describeTable(table, { transaction });
  return Object.prototype.hasOwnProperty.call(columns, column);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      if (!await columnExists(queryInterface, 'contacts', 'normalized_phone', transaction)) {
        await queryInterface.addColumn('contacts', 'normalized_phone', {
          type: Sequelize.STRING(20), allowNull: true
        }, { transaction });
      }
      if (!await columnExists(queryInterface, 'conversations', 'normalized_phone', transaction)) {
        await queryInterface.addColumn('conversations', 'normalized_phone', {
          type: Sequelize.STRING(20), allowNull: true
        }, { transaction });
      }

      await queryInterface.sequelize.query(`
        UPDATE contacts
        SET normalized_phone = CASE
          WHEN regexp_replace(COALESCE(phone, whatsapp_id, ''), '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
            THEN '94' || substring(regexp_replace(COALESCE(phone, whatsapp_id, ''), '[^0-9]', '', 'g') FROM 2)
          WHEN regexp_replace(COALESCE(phone, whatsapp_id, ''), '[^0-9]', '', 'g') ~ '^00[0-9]{7,15}$'
            THEN substring(regexp_replace(COALESCE(phone, whatsapp_id, ''), '[^0-9]', '', 'g') FROM 3)
          WHEN regexp_replace(COALESCE(phone, whatsapp_id, ''), '[^0-9]', '', 'g') ~ '^[0-9]{7,15}$'
            THEN regexp_replace(COALESCE(phone, whatsapp_id, ''), '[^0-9]', '', 'g')
          ELSE NULL
        END
        WHERE normalized_phone IS NULL
      `, { transaction });

      await queryInterface.sequelize.query(`
        UPDATE conversations AS conversation
        SET normalized_phone = contact.normalized_phone
        FROM contacts AS contact
        WHERE conversation.contact_id = contact.id
          AND conversation.normalized_phone IS NULL
      `, { transaction });

      await queryInterface.sequelize.query(
        'CREATE INDEX IF NOT EXISTS contacts_normalized_phone_idx ON contacts (normalized_phone)',
        { transaction }
      );
      await queryInterface.sequelize.query(
        'CREATE INDEX IF NOT EXISTS conversations_normalized_phone_idx ON conversations (normalized_phone)',
        { transaction }
      );

      const [duplicates] = await queryInterface.sequelize.query(`
        SELECT COALESCE(whatsapp_account_id, 0) AS account_key, normalized_phone
        FROM conversations
        WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL
        GROUP BY COALESCE(whatsapp_account_id, 0), normalized_phone
        HAVING COUNT(*) > 1
        LIMIT 1
      `, { transaction });
      if (!duplicates.length) {
        await queryInterface.sequelize.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS conversations_account_normalized_phone_unique
          ON conversations (COALESCE(whatsapp_account_id, 0), normalized_phone)
          WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL
        `, { transaction });
      } else {
        console.warn('Conversation identity duplicates remain; run npm run repair:conversations -- --apply before accepting traffic.');
      }
    });
  },
  async down() {}
};

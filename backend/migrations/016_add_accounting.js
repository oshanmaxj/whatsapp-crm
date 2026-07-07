module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS accounting_categories (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS accounting_categories_name_type_unique ON accounting_categories (LOWER(name), type)');
    await sequelize.query('CREATE INDEX IF NOT EXISTS accounting_categories_type_active_idx ON accounting_categories (type, is_active)');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS accounting_transactions (
        id BIGSERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
        date DATE NOT NULL,
        amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
        category_id BIGINT NOT NULL REFERENCES accounting_categories(id),
        payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'card', 'online', 'other')),
        reference_no VARCHAR(120),
        description TEXT,
        related_student_id BIGINT,
        related_course_id BIGINT,
        related_campaign_id BIGINT,
        created_by BIGINT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await sequelize.query('CREATE INDEX IF NOT EXISTS accounting_transactions_type_date_idx ON accounting_transactions (type, date)');
    await sequelize.query('CREATE INDEX IF NOT EXISTS accounting_transactions_category_id_idx ON accounting_transactions (category_id)');
    await sequelize.query('CREATE INDEX IF NOT EXISTS accounting_transactions_payment_method_idx ON accounting_transactions (payment_method)');
    await sequelize.query('CREATE INDEX IF NOT EXISTS accounting_transactions_created_by_idx ON accounting_transactions (created_by)');

    const defaults = [
      ['Course Fees', 'income'], ['Registration Fees', 'income'], ['Seminar Fees', 'income'], ['Other Income', 'income'],
      ['Lecturer Payments', 'expense'], ['Ads / Marketing', 'expense'], ['Staff Salary', 'expense'],
      ['Office Rent', 'expense'], ['Utilities', 'expense'], ['Internet / Phone', 'expense'],
      ['Software', 'expense'], ['Other Expenses', 'expense']
    ];
    for (const [name, type] of defaults) {
      await sequelize.query(`
        INSERT INTO accounting_categories (name, type, created_at, updated_at)
        VALUES (:name, :type, NOW(), NOW())
        ON CONFLICT (LOWER(name), type) DO NOTHING
      `, { replacements: { name, type } });
    }
  },
  async down() {
    // Non-destructive by design for production accounting records.
  }
};

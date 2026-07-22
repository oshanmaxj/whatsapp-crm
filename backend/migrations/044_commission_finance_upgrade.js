const PERMISSIONS = [
  'commission.view', 'commission.view_own', 'commission.rule_manage',
  'commission.lecturer_agreement_manage', 'commission.approve',
  'commission.payout_create', 'commission.payout_approve',
  'commission.payout_mark_paid', 'commission.adjust', 'commission.reverse',
  'commission.export', 'commission.profitability_view',
  'commission.accounting_reconcile'
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const db = queryInterface.sequelize;
    const dialect = db.getDialect();
    if (dialect !== 'postgres') throw new Error('Migration 044 requires PostgreSQL.');

    // Inspect deployed schemas first: installations can pre-date parts of migration 026.
    const table = async (name) => queryInterface.describeTable(name).catch(() => null);
    const rules = await table('commission_rules');
    const permissions = await table('permissions');
    const rolePermissions = await table('role_permissions');
    const roles = await table('roles');
    if (!rules || !permissions || !rolePermissions || !roles) {
      throw new Error('Required commission/access-control schema is missing; apply earlier migrations first.');
    }

    const upgradingLegacyRules = !rules.earning_type;
    const addRuleColumn = async (name, definition) => {
      if (!rules[name]) await queryInterface.addColumn('commission_rules', name, definition);
    };
    await addRuleColumn('earning_type', { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'agent_commission' });
    await addRuleColumn('scope_id', { type: Sequelize.BIGINT, allowNull: true });
    await addRuleColumn('beneficiary_type', { type: Sequelize.STRING(30), allowNull: true });
    await addRuleColumn('beneficiary_id', { type: Sequelize.BIGINT, allowNull: true });
    await addRuleColumn('calculation_type', { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'percentage_collected' });
    await addRuleColumn('tier_configuration', { type: Sequelize.JSONB, allowNull: true });
    await addRuleColumn('stackable', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addRuleColumn('exclusive', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await addRuleColumn('approval_required', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await addRuleColumn('payout_delay_days', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addRuleColumn('status', { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'active' });
    await addRuleColumn('updated_by_user_id', { type: Sequelize.BIGINT, allowNull: true });
    await addRuleColumn('deleted_at', { type: Sequelize.DATE, allowNull: true });
    const installments = await table('fee_installments');
    if (!installments?.attribution_department_id) await queryInterface.addColumn('fee_installments','attribution_department_id',{type:Sequelize.BIGINT,allowNull:true});

    if (upgradingLegacyRules) {
      // Migration 026 allowed several concurrently active rules whose scope was held in
      // legacy columns. Preserve them as stackable until an administrator explicitly
      // converts/activates canonical exclusive rules.
      await db.query(`UPDATE commission_rules SET exclusive=FALSE, stackable=TRUE WHERE deleted_at IS NULL`);
    }
    await db.query(`WITH duplicates AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS ordinal FROM commission_rules
      WHERE LOWER(TRIM(name))='new global rule' AND COALESCE(percentage_rate,0)=0
        AND COALESCE(fixed_amount,0)=0 AND agent_user_id IS NULL AND department_id IS NULL AND course_id IS NULL
    ) UPDATE commission_rules r SET status='archived', active=FALSE, deleted_at=COALESCE(r.deleted_at,NOW())
      FROM duplicates d WHERE r.id=d.id AND d.ordinal>1`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS lecturer_agreements (
        id BIGSERIAL PRIMARY KEY, lecturer_user_id BIGINT NOT NULL REFERENCES users(id),
        course_id BIGINT NOT NULL REFERENCES courses(id), batch_id BIGINT REFERENCES batches(id),
        start_date DATE NOT NULL, end_date DATE, calculation_type VARCHAR(50) NOT NULL,
        percentage_rate NUMERIC(9,4), fixed_amount NUMERIC(18,2), revenue_basis VARCHAR(40) NOT NULL DEFAULT 'gross_collected',
        allocation_percentage NUMERIC(9,4), minimum_guarantee NUMERIC(18,2), maximum_cap NUMERIC(18,2),
        payment_per_student NUMERIC(18,2), payment_per_session NUMERIC(18,2), number_of_sessions INTEGER,
        tier_configuration JSONB, status VARCHAR(20) NOT NULL DEFAULT 'draft', notes TEXT,
        contract_reference VARCHAR(180), approved_by_user_id BIGINT REFERENCES users(id),
        created_by_user_id BIGINT REFERENCES users(id), updated_by_user_id BIGINT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS commission_ledger (
        id BIGSERIAL PRIMARY KEY, source_payment_id BIGINT REFERENCES fee_installments(id),
        source_accounting_transaction_id BIGINT REFERENCES accounting_transactions(id), earning_type VARCHAR(40) NOT NULL,
        earning_component VARCHAR(60) NOT NULL, beneficiary_type VARCHAR(30) NOT NULL, beneficiary_id BIGINT NOT NULL,
        rule_id BIGINT REFERENCES commission_rules(id), lecturer_agreement_id BIGINT REFERENCES lecturer_agreements(id),
        student_id BIGINT REFERENCES students(id), enrollment_id BIGINT REFERENCES student_enrollments(id), course_id BIGINT REFERENCES courses(id), batch_id BIGINT REFERENCES batches(id),
        lead_id BIGINT REFERENCES leads(id), whatsapp_account_id BIGINT REFERENCES whatsapp_accounts(id),
        gross_payment NUMERIC(18,2) NOT NULL, discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        refund_amount NUMERIC(18,2) NOT NULL DEFAULT 0, calculation_basis NUMERIC(18,2) NOT NULL,
        rate NUMERIC(9,4), amount NUMERIC(18,2) NOT NULL, direct_expenses NUMERIC(18,2) NOT NULL DEFAULT 0,
        institute_margin NUMERIC(18,2) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'pending',
        payable_at TIMESTAMPTZ, reversal_of_id BIGINT REFERENCES commission_ledger(id), idempotency_key VARCHAR(255) NOT NULL,
        payout_id BIGINT, created_by_user_id BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT commission_ledger_idempotency_unique UNIQUE(idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS commission_calculation_snapshots (
        id BIGSERIAL PRIMARY KEY, ledger_id BIGINT NOT NULL UNIQUE REFERENCES commission_ledger(id),
        student_name VARCHAR(200), registration_number VARCHAR(100), course_name VARCHAR(200), batch_name VARCHAR(200),
        payment_reference VARCHAR(180), payment_method VARCHAR(60), beneficiary_name VARCHAR(200), rule_name VARCHAR(180),
        rule_version JSONB, calculation JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS commission_approvals (
        id BIGSERIAL PRIMARY KEY, ledger_id BIGINT REFERENCES commission_ledger(id), payout_id BIGINT,
        approver_user_id BIGINT NOT NULL REFERENCES users(id), approver_role VARCHAR(100), action VARCHAR(30) NOT NULL,
        comment TEXT, before_status VARCHAR(30), after_status VARCHAR(30), ip_address VARCHAR(64), user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS commission_payouts (
        id BIGSERIAL PRIMARY KEY, payout_number VARCHAR(40) NOT NULL UNIQUE, beneficiary_type VARCHAR(30) NOT NULL,
        beneficiary_id BIGINT NOT NULL, period_start DATE, period_end DATE, gross_earnings NUMERIC(18,2) NOT NULL DEFAULT 0,
        adjustments NUMERIC(18,2) NOT NULL DEFAULT 0, deductions NUMERIC(18,2) NOT NULL DEFAULT 0,
        net_payable NUMERIC(18,2) NOT NULL DEFAULT 0, actual_paid NUMERIC(18,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(40), bank_reference VARCHAR(180), paid_date DATE, notes TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'draft', accounting_expense_transaction_id BIGINT REFERENCES accounting_transactions(id),
        created_by_user_id BIGINT NOT NULL REFERENCES users(id), approved_by_user_id BIGINT REFERENCES users(id),
        reconciled_by_user_id BIGINT REFERENCES users(id), reconciled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS commission_payout_ledger_items (
        id BIGSERIAL PRIMARY KEY, payout_id BIGINT NOT NULL REFERENCES commission_payouts(id),
        ledger_id BIGINT NOT NULL REFERENCES commission_ledger(id), allocated_amount NUMERIC(18,2) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(payout_id, ledger_id)
      );
      CREATE TABLE IF NOT EXISTS commission_accounting_links (
        id BIGSERIAL PRIMARY KEY, ledger_id BIGINT REFERENCES commission_ledger(id), payout_id BIGINT REFERENCES commission_payouts(id),
        accounting_transaction_id BIGINT NOT NULL REFERENCES accounting_transactions(id), link_type VARCHAR(40) NOT NULL,
        reversal_of_id BIGINT REFERENCES commission_accounting_links(id), idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS commission_payables (
        id BIGSERIAL PRIMARY KEY, ledger_id BIGINT NOT NULL UNIQUE REFERENCES commission_ledger(id),
        beneficiary_type VARCHAR(30) NOT NULL, beneficiary_id BIGINT NOT NULL,
        original_amount NUMERIC(18,2) NOT NULL, outstanding_amount NUMERIC(18,2) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'payable', reversal_of_id BIGINT REFERENCES commission_payables(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS commission_expense_allocations (
        id BIGSERIAL PRIMARY KEY, accounting_transaction_id BIGINT NOT NULL REFERENCES accounting_transactions(id), source_payment_id BIGINT REFERENCES fee_installments(id),
        allocation_type VARCHAR(30) NOT NULL, allocation_id BIGINT, period_start DATE, period_end DATE,
        amount NUMERIC(18,2) NOT NULL, created_by_user_id BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(accounting_transaction_id, allocation_type, allocation_id, period_start, period_end)
      );
      CREATE INDEX IF NOT EXISTS commission_ledger_payment_idx ON commission_ledger(source_payment_id);
      CREATE INDEX IF NOT EXISTS commission_ledger_beneficiary_idx ON commission_ledger(beneficiary_type, beneficiary_id);
      CREATE INDEX IF NOT EXISTS commission_ledger_status_date_idx ON commission_ledger(status, created_at);
      CREATE INDEX IF NOT EXISTS commission_ledger_course_batch_idx ON commission_ledger(course_id, batch_id);
      CREATE INDEX IF NOT EXISTS lecturer_agreements_lookup_idx ON lecturer_agreements(course_id, batch_id, lecturer_user_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS commission_rules_active_exclusive_unique
        ON commission_rules(earning_type, scope_type, COALESCE(scope_id, 0), COALESCE(beneficiary_id, 0))
        WHERE status = 'active' AND exclusive = TRUE AND deleted_at IS NULL;
    `);
    await db.query('ALTER TABLE commission_ledger ADD COLUMN IF NOT EXISTS enrollment_id BIGINT REFERENCES student_enrollments(id)');
    await db.query('ALTER TABLE commission_ledger ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES users(id)');
    await db.query('ALTER TABLE commission_expense_allocations ADD COLUMN IF NOT EXISTS source_payment_id BIGINT REFERENCES fee_installments(id)');
    await db.query('ALTER TABLE commission_payout_ledger_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE');
    await db.query('DROP INDEX IF EXISTS commission_payout_ledger_unique');
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS commission_payout_active_ledger_unique ON commission_payout_ledger_items(ledger_id) WHERE active=TRUE');

    for (const code of PERMISSIONS) {
      await db.query(`INSERT INTO permissions (code, name, description, created_at, updated_at)
        VALUES (:code, :name, :description, NOW(), NOW()) ON CONFLICT (code) DO NOTHING`, {
        replacements: { code, name: code, description: `Commission permission: ${code}` }
      });
    }
    const grantTimestamp = rolePermissions.granted_at ? 'granted_at' : rolePermissions.created_at ? 'created_at' : null;
    await db.query(`INSERT INTO role_permissions (role_id, permission_id${grantTimestamp ? `, ${grantTimestamp}` : ''})
      SELECT r.id, p.id${grantTimestamp ? ', NOW()' : ''} FROM roles r CROSS JOIN permissions p
      WHERE LOWER(r.name) = 'admin' AND p.code = ANY(ARRAY[:codes])
      ON CONFLICT DO NOTHING`, { replacements: { codes: PERMISSIONS } });
  },
  async down() {
    // Financial history and access grants are intentionally non-destructive.
  }
};

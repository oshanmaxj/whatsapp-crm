require('dotenv').config();

const sequelize = require('../config/database');
const Sequelize = require('sequelize');
const { DataTypes } = Sequelize;
const birthdayWishesMigration = require('../../migrations/002_create_birthday_wishes');
const messageStatusMigration = require('../../migrations/003_add_message_status_tracking');
const messageReplyContextMigration = require('../../migrations/004_add_message_reply_context');
const roleChatVisibilityMigration = require('../../migrations/005_add_role_chat_visibility_scope');
const messageSenderTrackingMigration = require('../../migrations/006_add_message_sender_tracking');
const conversationRoleAssignmentMigration = require('../../migrations/007_add_conversation_role_assignment');
const departmentNotificationSettingsMigration = require('../../migrations/008_add_department_and_assignment_notification_settings');
const broadcastQueueTrackingMigration = require('../../migrations/009_add_broadcast_queue_tracking');
const messageContextFieldsMigration = require('../../migrations/010_add_message_context_fields');
const interactiveMessageFieldsMigration = require('../../migrations/011_add_interactive_message_fields');
const flowBuilderUpgradeMigration = require('../../migrations/012_upgrade_flow_builder');
const multiWhatsAppAccountsMigration = require('../../migrations/013_add_multi_whatsapp_accounts');
const departmentWhatsAppAccountsMigration = require('../../migrations/014_add_department_whatsapp_accounts');
const repairDepartmentWhatsAppMappingMigration = require('../../migrations/015_repair_department_whatsapp_mapping');
const accountingMigration = require('../../migrations/016_add_accounting');
const paymentApprovalMigration = require('../../migrations/017_add_payment_approval_and_notification_templates');
const studentLmsPortalMigration = require('../../migrations/018_add_student_lms_portal');
const studentAutomationSecureLmsMigration = require('../../migrations/019_add_student_message_automation_and_secure_live_classes');
const studentEnrollmentsMigration = require('../../migrations/020_add_student_enrollments');
const courseSchedulerMigration = require('../../migrations/021_add_course_scheduler_and_zoom_recordings');
const flowRunErrorDetailsMigration = require('../../migrations/022_add_flow_run_error_details');
const passwordResetTokensMigration = require('../../migrations/023_create_password_reset_tokens');
const secureStudentPortalOtpMigration = require('../../migrations/024_secure_student_portal_otp');
const secureConversationOwnershipMigration = require('../../migrations/025_secure_conversation_ownership');
const commissionManagementMigration = require('../../migrations/026_create_commission_management');
const leadPipelineMigration = require('../../migrations/027_lead_pipeline_followups');

async function columnExists(queryInterface, tableName, columnName) {
  const tableDesc = await queryInterface.describeTable(tableName).catch(() => null);
  if (!tableDesc) return false;
  return Object.prototype.hasOwnProperty.call(tableDesc, columnName);
}

async function safeAddColumn(queryInterface, tableName, columnName, definition) {
  const exists = await columnExists(queryInterface, tableName, columnName);
  if (exists) {
    console.log(`Skipping: ${tableName}.${columnName} already exists`);
    return;
  }

  try {
    console.log(`Adding column ${tableName}.${columnName}`);
    await queryInterface.addColumn(tableName, columnName, definition);
    console.log(`Added: ${tableName}.${columnName}`);
  } catch (err) {
    console.error(`Failed to add ${tableName}.${columnName}:`, err.message || err);
  }
}

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  return indexes.some((index) => index.name === indexName);
}

async function safeAddIndex(queryInterface, tableName, fields, options = {}) {
  const indexName = options.name || `${tableName}_${fields.join('_')}_idx`;
  const exists = await indexExists(queryInterface, tableName, indexName);
  if (exists) {
    console.log(`Skipping: index ${indexName} already exists`);
    return;
  }

  try {
    console.log(`Adding index ${indexName}`);
    await queryInterface.addIndex(tableName, fields, { ...options, name: indexName });
    console.log(`Added: index ${indexName}`);
  } catch (err) {
    console.error(`Failed to add index ${indexName}:`, err.message || err);
  }
}

async function run() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected. Running migrations...');

    const queryInterface = sequelize.getQueryInterface();

    const birthdayWishesCreated = await birthdayWishesMigration.up(queryInterface, Sequelize);
    console.log(birthdayWishesCreated
      ? 'Created: birthday_wishes'
      : 'Skipping: birthday_wishes already exists');

    await messageStatusMigration.up(queryInterface, Sequelize);
    console.log('Applied: message status tracking');

    await messageReplyContextMigration.up(queryInterface, Sequelize);
    console.log('Applied: message reply context');

    await roleChatVisibilityMigration.up(queryInterface, Sequelize);
    console.log('Applied: role chat visibility scope');

    await messageSenderTrackingMigration.up(queryInterface, Sequelize);
    console.log('Applied: message sender tracking');

    await conversationRoleAssignmentMigration.up(queryInterface, Sequelize);
    console.log('Applied: conversation role/team assignment');

    await departmentNotificationSettingsMigration.up(queryInterface, Sequelize);
    console.log('Applied: department and assignment notification settings');

    await broadcastQueueTrackingMigration.up(queryInterface, Sequelize);
    console.log('Applied: broadcast queue tracking');

    await messageContextFieldsMigration.up(queryInterface, Sequelize);
    console.log('Applied: broadcast and internal message context');

    await interactiveMessageFieldsMigration.up(queryInterface, Sequelize);
    console.log('Applied: interactive WhatsApp message fields');

    await flowBuilderUpgradeMigration.up(queryInterface, Sequelize);
    console.log('Applied: flow builder runtime upgrade');

    await multiWhatsAppAccountsMigration.up(queryInterface, Sequelize);
    console.log('Applied: multi WhatsApp account support');

    await departmentWhatsAppAccountsMigration.up(queryInterface, Sequelize);
    console.log('Applied: department WhatsApp account mapping');

    await repairDepartmentWhatsAppMappingMigration.up(queryInterface, Sequelize);
    console.log('Applied: department WhatsApp account mapping repair');

    await accountingMigration.up(queryInterface, Sequelize);
    console.log('Applied: accounting income and expenses');

    await paymentApprovalMigration.up(queryInterface, Sequelize);
    console.log('Applied: payment approval and notification templates');

    await studentLmsPortalMigration.up(queryInterface, Sequelize);
    console.log('Applied: student LMS portal');

    await studentAutomationSecureLmsMigration.up(queryInterface, Sequelize);
    console.log('Applied: student message automation and secure live classes');

    await studentEnrollmentsMigration.up(queryInterface, Sequelize);
    console.log('Applied: multi-course student enrollments');

    await courseSchedulerMigration.up(queryInterface, Sequelize);
    console.log('Applied: course scheduler and Zoom recording imports');

    await flowRunErrorDetailsMigration.up(queryInterface, Sequelize);
    console.log('Applied: flow run error details');

    await passwordResetTokensMigration.up(queryInterface, Sequelize);
    console.log('Applied: password reset tokens');

    await secureStudentPortalOtpMigration.up(queryInterface, Sequelize);
    console.log('Applied: secure student portal OTP');
    await secureConversationOwnershipMigration.up(queryInterface, Sequelize);
    console.log('Applied: secure conversation ownership and attribution');
    await commissionManagementMigration.up(queryInterface, Sequelize);
    console.log('Applied: commission management');
    await leadPipelineMigration.up(queryInterface, Sequelize);
    console.log('Applied: lead pipeline and follow-up control');

    // Leads
    await safeAddColumn(queryInterface, 'leads', 'ai_score', { type: DataTypes.INTEGER.UNSIGNED, allowNull: true });
    await safeAddColumn(queryInterface, 'leads', 'qualification_status', { type: DataTypes.STRING(50), allowNull: true });
    await safeAddColumn(queryInterface, 'leads', 'qualification_notes', { type: DataTypes.TEXT, allowNull: true });
    await safeAddColumn(queryInterface, 'leads', 'sentiment', { type: DataTypes.ENUM('positive', 'neutral', 'negative'), allowNull: true });

    // Conversations
    await safeAddColumn(queryInterface, 'conversations', 'summary', { type: DataTypes.TEXT, allowNull: true });
    await safeAddColumn(queryInterface, 'conversations', 'suggested_agent', { type: DataTypes.STRING(255), allowNull: true });

    // Messages
    await safeAddColumn(queryInterface, 'messages', 'sentiment', { type: DataTypes.ENUM('positive', 'neutral', 'negative'), allowNull: true });
    await safeAddColumn(queryInterface, 'messages', 'sentiment_score', { type: DataTypes.DECIMAL(5, 4), allowNull: true });

    // Production hardening indexes
    await safeAddIndex(queryInterface, 'leads', ['owner_id', 'created_at']);
    await safeAddIndex(queryInterface, 'leads', ['status_id', 'created_at']);
    await safeAddIndex(queryInterface, 'leads', ['source_id', 'created_at']);
    await safeAddIndex(queryInterface, 'leads', ['course_interested']);
    await safeAddIndex(queryInterface, 'leads', ['created_at']);
    await safeAddIndex(queryInterface, 'contacts', ['status', 'created_at']);
    await safeAddIndex(queryInterface, 'contacts', ['created_at']);
    await safeAddIndex(queryInterface, 'conversations', ['status', 'updated_at']);
    await safeAddIndex(queryInterface, 'conversations', ['last_message_at']);
    await safeAddIndex(queryInterface, 'conversations', ['updated_at']);
    await safeAddIndex(queryInterface, 'messages', ['conversation_id', 'created_at']);
    await safeAddIndex(queryInterface, 'messages', ['conversation_id', 'is_read']);
    await safeAddIndex(queryInterface, 'messages', ['created_at']);
    await safeAddIndex(queryInterface, 'message_queue', ['status', 'scheduled_at', 'priority']);
    await safeAddIndex(queryInterface, 'message_queue', ['status', 'next_attempt_at']);
    await safeAddIndex(queryInterface, 'user_roles', ['user_id']);
    await safeAddIndex(queryInterface, 'user_roles', ['role_id']);
    await safeAddIndex(queryInterface, 'role_permissions', ['role_id']);
    await safeAddIndex(queryInterface, 'role_permissions', ['permission_id']);

    console.log('Migrations complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration runner failed:', err);
    process.exit(1);
  }
}

run();

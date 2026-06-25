const Sequelize = require('sequelize');
const sequelize = require('../config/database');

const User = require('./user.model');
const Role = require('./role.model');
const Permission = require('./permission.model');
const UserRole = require('./userRole.model');
const RolePermission = require('./rolePermission.model');
const Message = require('./message.model');
const Contact = require('./contact.model');
const LeadStatus = require('./leadStatus.model');
const LeadSource = require('./leadSource.model');
const Lead = require('./lead.model');
const LeadAssignment = require('./leadAssignment.model');
const Conversation = require('./conversation.model');
const Followup = require('./followup.model');
const AutoReply = require('./autoReply.model');
const Media = require('./media.model');
const ConversationNote = require('./conversationNote.model');
const Label = require('./label.model');
const ConversationLabel = require('./conversationLabel.model');
const MessageTemplate = require('./messageTemplate.model');
const Campaign = require('./campaign.model');
const CampaignRecipient = require('./campaignRecipient.model');
const CampaignEvent = require('./campaignEvent.model');
const Workflow = require('./workflow.model');
const WorkflowStep = require('./workflowStep.model');
const WorkflowRun = require('./workflowRun.model');
const Flow = require('./flow.model');
const FlowNode = require('./flowNode.model');
const FlowConnection = require('./flowConnection.model');
const FlowRun = require('./flowRun.model');
const FlowRunLog = require('./flowRunLog.model');
const GoogleSheetConnection = require('./googleSheetConnection.model');
const Appointment = require('./appointment.model');
const AppointmentRequest = require('./appointmentRequest.model');
const Course = require('./course.model');
const Batch = require('./batch.model');
const Student = require('./student.model');
const StudentFee = require('./studentFee.model');
const FeeInstallment = require('./feeInstallment.model');
const AttendanceRecord = require('./attendanceRecord.model');
const Certificate = require('./certificate.model');
const MessageQueue = require('./messageQueue.model');
const Notification = require('./notification.model');
const AuditLog = require('./auditLog.model');
const AppSetting = require('./appSetting.model');
const BackupJob = require('./backupJob.model');
const LoginHistory = require('./loginHistory.model');
const PasswordResetToken = require('./passwordResetToken.model');

const models = {
  User: User(sequelize, Sequelize.DataTypes),
  Role: Role(sequelize, Sequelize.DataTypes),
  Permission: Permission(sequelize, Sequelize.DataTypes),
  UserRole: UserRole(sequelize, Sequelize.DataTypes),
  RolePermission: RolePermission(sequelize, Sequelize.DataTypes),
  Message: Message(sequelize, Sequelize.DataTypes),
  Contact: Contact(sequelize, Sequelize.DataTypes),
  LeadStatus: LeadStatus(sequelize, Sequelize.DataTypes),
  LeadSource: LeadSource(sequelize, Sequelize.DataTypes),
  Lead: Lead(sequelize, Sequelize.DataTypes),
  LeadAssignment: LeadAssignment(sequelize, Sequelize.DataTypes),
  Conversation: Conversation(sequelize, Sequelize.DataTypes),
  Followup: Followup(sequelize, Sequelize.DataTypes),
  AutoReply: AutoReply(sequelize, Sequelize.DataTypes),
  Media: Media(sequelize, Sequelize.DataTypes),
  ConversationNote: ConversationNote(sequelize, Sequelize.DataTypes),
  Label: Label(sequelize, Sequelize.DataTypes),
  ConversationLabel: ConversationLabel(sequelize, Sequelize.DataTypes),
  MessageTemplate: MessageTemplate(sequelize, Sequelize.DataTypes),
  Campaign: Campaign(sequelize, Sequelize.DataTypes),
  CampaignRecipient: CampaignRecipient(sequelize, Sequelize.DataTypes),
  CampaignEvent: CampaignEvent(sequelize, Sequelize.DataTypes),
  Workflow: Workflow(sequelize, Sequelize.DataTypes),
  WorkflowStep: WorkflowStep(sequelize, Sequelize.DataTypes),
  WorkflowRun: WorkflowRun(sequelize, Sequelize.DataTypes),
  Flow: Flow(sequelize, Sequelize.DataTypes),
  FlowNode: FlowNode(sequelize, Sequelize.DataTypes),
  FlowConnection: FlowConnection(sequelize, Sequelize.DataTypes),
  FlowRun: FlowRun(sequelize, Sequelize.DataTypes),
  FlowRunLog: FlowRunLog(sequelize, Sequelize.DataTypes),
  GoogleSheetConnection: GoogleSheetConnection(sequelize, Sequelize.DataTypes),
  Appointment: Appointment(sequelize, Sequelize.DataTypes),
  AppointmentRequest: AppointmentRequest(sequelize, Sequelize.DataTypes),
  Course: Course(sequelize, Sequelize.DataTypes),
  Batch: Batch(sequelize, Sequelize.DataTypes),
  Student: Student(sequelize, Sequelize.DataTypes),
  StudentFee: StudentFee(sequelize, Sequelize.DataTypes),
  FeeInstallment: FeeInstallment(sequelize, Sequelize.DataTypes),
  AttendanceRecord: AttendanceRecord(sequelize, Sequelize.DataTypes),
  Certificate: Certificate(sequelize, Sequelize.DataTypes),
  MessageQueue: MessageQueue(sequelize, Sequelize.DataTypes),
  Notification: Notification(sequelize, Sequelize.DataTypes),
  AuditLog: AuditLog(sequelize, Sequelize.DataTypes),
  AppSetting: AppSetting(sequelize, Sequelize.DataTypes),
  BackupJob: BackupJob(sequelize, Sequelize.DataTypes),
  LoginHistory: LoginHistory(sequelize, Sequelize.DataTypes),
  PasswordResetToken: PasswordResetToken(sequelize, Sequelize.DataTypes)
};

models.User.belongsToMany(models.Role, {
  through: models.UserRole,
  as: 'roles',
  foreignKey: 'user_id',
  otherKey: 'role_id'
});
models.Role.belongsToMany(models.User, {
  through: models.UserRole,
  as: 'users',
  foreignKey: 'role_id',
  otherKey: 'user_id'
});

models.Role.belongsToMany(models.Permission, {
  through: models.RolePermission,
  as: 'permissions',
  foreignKey: 'role_id',
  otherKey: 'permission_id'
});
models.Permission.belongsToMany(models.Role, {
  through: models.RolePermission,
  as: 'roles',
  foreignKey: 'permission_id',
  otherKey: 'role_id'
});

models.Contact.hasMany(models.Lead, { foreignKey: 'contact_id', as: 'leads' });
models.User.hasMany(models.Lead, { foreignKey: 'owner_id', as: 'ownedLeads' });
models.LeadStatus.hasMany(models.Lead, { foreignKey: 'status_id', as: 'leads' });
models.LeadSource.hasMany(models.Lead, { foreignKey: 'source_id', as: 'leads' });

models.Lead.hasMany(models.LeadAssignment, { foreignKey: 'lead_id', as: 'assignments' });
models.User.hasMany(models.LeadAssignment, { foreignKey: 'assigned_to', as: 'leadAssignments' });

models.Contact.hasMany(models.Conversation, { foreignKey: 'contact_id', as: 'conversations' });
models.Lead.hasMany(models.Conversation, { foreignKey: 'lead_id', as: 'conversations' });

models.Conversation.hasMany(models.Message, { foreignKey: 'conversation_id', as: 'messages' });
models.Message.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
models.User.hasMany(models.Conversation, { foreignKey: 'assigned_to', as: 'assignedConversations' });

models.Conversation.belongsToMany(models.Label, {
  through: models.ConversationLabel,
  as: 'labels',
  foreignKey: 'conversation_id',
  otherKey: 'label_id'
});
models.Label.belongsToMany(models.Conversation, {
  through: models.ConversationLabel,
  as: 'conversations',
  foreignKey: 'label_id',
  otherKey: 'conversation_id'
});
models.Conversation.hasMany(models.ConversationNote, { foreignKey: 'conversation_id', as: 'notes' });
models.Conversation.hasMany(models.Media, { foreignKey: 'conversation_id', as: 'media' });
models.Message.hasOne(models.Media, { foreignKey: 'message_id', as: 'media' });

models.Campaign.hasMany(models.CampaignRecipient, { foreignKey: 'campaign_id', as: 'recipients' });
models.Campaign.hasMany(models.CampaignEvent, { foreignKey: 'campaign_id', as: 'events' });
models.CampaignRecipient.hasMany(models.CampaignEvent, { foreignKey: 'recipient_id', as: 'events' });
models.Workflow.hasMany(models.WorkflowStep, { foreignKey: 'workflow_id', as: 'steps' });
models.Workflow.hasMany(models.WorkflowRun, { foreignKey: 'workflow_id', as: 'runs' });
models.Appointment.hasMany(models.AppointmentRequest, { foreignKey: 'appointment_id', as: 'requests' });
models.Course.hasMany(models.Batch, { foreignKey: 'course_id', as: 'batches' });
models.Course.hasMany(models.Student, { foreignKey: 'course_id', as: 'students' });
models.Batch.hasMany(models.Student, { foreignKey: 'batch_id', as: 'students' });
models.Student.hasMany(models.StudentFee, { foreignKey: 'student_id', as: 'fees' });
models.StudentFee.hasMany(models.FeeInstallment, { foreignKey: 'fee_id', as: 'installments' });
models.Student.hasMany(models.AttendanceRecord, { foreignKey: 'student_id', as: 'attendance' });
models.Student.hasMany(models.Certificate, { foreignKey: 'student_id', as: 'certificates' });
models.User.hasMany(models.Notification, { foreignKey: 'user_id', as: 'notifications' });
models.User.hasMany(models.AuditLog, { foreignKey: 'user_id', as: 'auditLogs' });
models.User.hasMany(models.MessageQueue, { foreignKey: 'created_by', as: 'queuedMessages' });

models.Lead.hasMany(models.Followup, { foreignKey: 'lead_id', as: 'followups' });
models.Contact.hasMany(models.Followup, { foreignKey: 'contact_id', as: 'followups' });
models.User.hasMany(models.Followup, { foreignKey: 'assigned_to', as: 'assignedFollowups' });

Object.values(models)
  .filter((model) => typeof model.associate === 'function')
  .forEach((model) => model.associate(models));

module.exports = {
  sequelize,
  Sequelize,
  ...models
};

const Sequelize = require('sequelize');
const sequelize = require('../config/database');

const User = require('./user.model');
const Role = require('./role.model');
const Permission = require('./permission.model');
const UserRole = require('./userRole.model');
const RolePermission = require('./rolePermission.model');
const UserPermissionOverride = require('./userPermissionOverride.model');
const Message = require('./message.model');
const Contact = require('./contact.model');
const LeadStatus = require('./leadStatus.model');
const LeadSource = require('./leadSource.model');
const Lead = require('./lead.model');
const LeadAssignment = require('./leadAssignment.model');
const LostReason = require('./lostReason.model'); const LeadActivity = require('./leadActivity.model');
const Conversation = require('./conversation.model');
const ConversationAssignmentHistory = require('./conversationAssignmentHistory.model');
const Followup = require('./followup.model');
const AutoReply = require('./autoReply.model');
const Media = require('./media.model');
const ConversationNote = require('./conversationNote.model');
const Label = require('./label.model');
const ConversationLabel = require('./conversationLabel.model');
const MessageTemplate = require('./messageTemplate.model');
const WhatsAppTemplate = require('./whatsappTemplate.model');
const WhatsAppComplianceLog = require('./whatsappComplianceLog.model');
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
const StudentGuardian = require('./studentGuardian.model');
const AttendanceAlert = require('./attendanceAlert.model');
const BirthdayWish = require('./birthdayWish.model');
const ClassReminder = require('./classReminder.model');
const Automation = require('./automation.model');
const AutomationLog = require('./automationLog.model');
const StudentFee = require('./studentFee.model');
const FeeInstallment = require('./feeInstallment.model');
const FeeReminder = require('./feeReminder.model');
const AttendanceRecord = require('./attendanceRecord.model');
const Certificate = require('./certificate.model');
const StudentNote = require('./studentNote.model');
const StudentDocument = require('./studentDocument.model');
const MessageQueue = require('./messageQueue.model');
const Notification = require('./notification.model');
const AuditLog = require('./auditLog.model');
const AppSetting = require('./appSetting.model');
const BackupJob = require('./backupJob.model');
const LoginHistory = require('./loginHistory.model');
const PasswordResetToken = require('./passwordResetToken.model');
const AuthSession = require('./authSession.model');
const WhatsAppAccount = require('./whatsappAccount.model');
const RoleWhatsAppAccount = require('./roleWhatsappAccount.model');
const AccountingCategory = require('./accountingCategory.model');
const AccountingTransaction = require('./accountingTransaction.model');
const NotificationMessageTemplate = require('./notificationMessageTemplate.model');
const LmsCourse = require('./lmsCourse.model');
const LmsLesson = require('./lmsLesson.model');
const LmsTopic = require('./lmsTopic.model');
const LmsLessonBatchOverride = require('./lmsLessonBatchOverride.model');
const LmsLessonMaterial = require('./lmsLessonMaterial.model');
const LmsLessonComment = require('./lmsLessonComment.model');
const LmsStudentProgress = require('./lmsStudentProgress.model');
const StudentPortalSession = require('./studentPortalSession.model');
const StudentMessageTemplate = require('./studentMessageTemplate.model');
const StudentAutomationDispatch = require('./studentAutomationDispatch.model');
const LmsLiveClassJoin = require('./lmsLiveClassJoin.model');
const StudentEnrollment = require('./studentEnrollment.model');
const CourseSchedule = require('./courseSchedule.model');
const ScheduledLesson = require('./scheduledLesson.model');
const ZoomRecordingImport = require('./zoomRecordingImport.model');
const LessonAutoPublishLog = require('./lessonAutoPublishLog.model');
const CommissionRule = require('./commissionRule.model'); const CommissionTier = require('./commissionTier.model'); const AgentCommission = require('./agentCommission.model'); const CommissionAdjustment = require('./commissionAdjustment.model'); const CommissionPayoutBatch = require('./commissionPayoutBatch.model'); const CommissionPayoutItem = require('./commissionPayoutItem.model');

const models = {
  User: User(sequelize, Sequelize.DataTypes),
  Role: Role(sequelize, Sequelize.DataTypes),
  Permission: Permission(sequelize, Sequelize.DataTypes),
  UserRole: UserRole(sequelize, Sequelize.DataTypes),
  RolePermission: RolePermission(sequelize, Sequelize.DataTypes),
  UserPermissionOverride: UserPermissionOverride(sequelize, Sequelize.DataTypes),
  Message: Message(sequelize, Sequelize.DataTypes),
  Contact: Contact(sequelize, Sequelize.DataTypes),
  LeadStatus: LeadStatus(sequelize, Sequelize.DataTypes),
  LeadSource: LeadSource(sequelize, Sequelize.DataTypes),
  Lead: Lead(sequelize, Sequelize.DataTypes),
  LeadAssignment: LeadAssignment(sequelize, Sequelize.DataTypes),
  LostReason: LostReason(sequelize, Sequelize.DataTypes), LeadActivity: LeadActivity(sequelize, Sequelize.DataTypes),
  Conversation: Conversation(sequelize, Sequelize.DataTypes),
  ConversationAssignmentHistory: ConversationAssignmentHistory(sequelize, Sequelize.DataTypes),
  Followup: Followup(sequelize, Sequelize.DataTypes),
  AutoReply: AutoReply(sequelize, Sequelize.DataTypes),
  Media: Media(sequelize, Sequelize.DataTypes),
  ConversationNote: ConversationNote(sequelize, Sequelize.DataTypes),
  Label: Label(sequelize, Sequelize.DataTypes),
  ConversationLabel: ConversationLabel(sequelize, Sequelize.DataTypes),
  MessageTemplate: MessageTemplate(sequelize, Sequelize.DataTypes),
  WhatsAppTemplate: WhatsAppTemplate(sequelize, Sequelize.DataTypes),
  WhatsAppComplianceLog: WhatsAppComplianceLog(sequelize, Sequelize.DataTypes),
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
  StudentGuardian: StudentGuardian(sequelize, Sequelize.DataTypes),
  AttendanceAlert: AttendanceAlert(sequelize, Sequelize.DataTypes),
  BirthdayWish: BirthdayWish(sequelize, Sequelize.DataTypes),
  ClassReminder: ClassReminder(sequelize, Sequelize.DataTypes),
  Automation: Automation(sequelize, Sequelize.DataTypes),
  AutomationLog: AutomationLog(sequelize, Sequelize.DataTypes),
  StudentFee: StudentFee(sequelize, Sequelize.DataTypes),
  FeeInstallment: FeeInstallment(sequelize, Sequelize.DataTypes),
  FeeReminder: FeeReminder(sequelize, Sequelize.DataTypes),
  AttendanceRecord: AttendanceRecord(sequelize, Sequelize.DataTypes),
  Certificate: Certificate(sequelize, Sequelize.DataTypes),
  StudentNote: StudentNote(sequelize, Sequelize.DataTypes),
  StudentDocument: StudentDocument(sequelize, Sequelize.DataTypes),
  MessageQueue: MessageQueue(sequelize, Sequelize.DataTypes),
  Notification: Notification(sequelize, Sequelize.DataTypes),
  AuditLog: AuditLog(sequelize, Sequelize.DataTypes),
  AppSetting: AppSetting(sequelize, Sequelize.DataTypes),
  BackupJob: BackupJob(sequelize, Sequelize.DataTypes),
  LoginHistory: LoginHistory(sequelize, Sequelize.DataTypes),
  PasswordResetToken: PasswordResetToken(sequelize, Sequelize.DataTypes),
  AuthSession: AuthSession(sequelize, Sequelize.DataTypes),
  WhatsAppAccount: WhatsAppAccount(sequelize, Sequelize.DataTypes),
  RoleWhatsAppAccount: RoleWhatsAppAccount(sequelize, Sequelize.DataTypes),
  AccountingCategory: AccountingCategory(sequelize, Sequelize.DataTypes),
  AccountingTransaction: AccountingTransaction(sequelize, Sequelize.DataTypes),
  NotificationMessageTemplate: NotificationMessageTemplate(sequelize, Sequelize.DataTypes),
  LmsCourse: LmsCourse(sequelize, Sequelize.DataTypes),
  LmsLesson: LmsLesson(sequelize, Sequelize.DataTypes),
  LmsTopic: LmsTopic(sequelize, Sequelize.DataTypes),
  LmsLessonBatchOverride: LmsLessonBatchOverride(sequelize, Sequelize.DataTypes),
  LmsLessonMaterial: LmsLessonMaterial(sequelize, Sequelize.DataTypes),
  LmsLessonComment: LmsLessonComment(sequelize, Sequelize.DataTypes),
  LmsStudentProgress: LmsStudentProgress(sequelize, Sequelize.DataTypes),
  StudentPortalSession: StudentPortalSession(sequelize, Sequelize.DataTypes),
  StudentMessageTemplate: StudentMessageTemplate(sequelize, Sequelize.DataTypes),
  StudentAutomationDispatch: StudentAutomationDispatch(sequelize, Sequelize.DataTypes),
  LmsLiveClassJoin: LmsLiveClassJoin(sequelize, Sequelize.DataTypes),
  StudentEnrollment: StudentEnrollment(sequelize, Sequelize.DataTypes),
  CourseSchedule: CourseSchedule(sequelize, Sequelize.DataTypes),
  ScheduledLesson: ScheduledLesson(sequelize, Sequelize.DataTypes),
  ZoomRecordingImport: ZoomRecordingImport(sequelize, Sequelize.DataTypes),
  LessonAutoPublishLog: LessonAutoPublishLog(sequelize, Sequelize.DataTypes),
  CommissionRule: CommissionRule(sequelize, Sequelize.DataTypes), CommissionTier: CommissionTier(sequelize, Sequelize.DataTypes), AgentCommission: AgentCommission(sequelize, Sequelize.DataTypes), CommissionAdjustment: CommissionAdjustment(sequelize, Sequelize.DataTypes), CommissionPayoutBatch: CommissionPayoutBatch(sequelize, Sequelize.DataTypes), CommissionPayoutItem: CommissionPayoutItem(sequelize, Sequelize.DataTypes)
};

models.User.belongsToMany(models.Role, {
  through: models.UserRole,
  as: 'roles',
  foreignKey: 'userId',
  otherKey: 'roleId'
});
models.Role.belongsToMany(models.User, {
  through: models.UserRole,
  as: 'users',
  foreignKey: 'roleId',
  otherKey: 'userId'
});
models.Role.belongsToMany(models.WhatsAppAccount, {
  through: models.RoleWhatsAppAccount,
  as: 'whatsappAccounts',
  foreignKey: 'roleId',
  otherKey: 'whatsappAccountId'
});
models.WhatsAppAccount.belongsToMany(models.Role, {
  through: models.RoleWhatsAppAccount,
  as: 'roles',
  foreignKey: 'whatsappAccountId',
  otherKey: 'roleId'
});

models.Role.belongsToMany(models.Permission, {
  through: models.RolePermission,
  as: 'permissions',
  foreignKey: 'roleId',
  otherKey: 'permissionId'
});
models.Permission.belongsToMany(models.Role, {
  through: models.RolePermission,
  as: 'roles',
  foreignKey: 'permissionId',
  otherKey: 'roleId'
});

models.Contact.hasMany(models.Lead, { foreignKey: 'contact_id', as: 'leads' });
models.User.hasMany(models.Lead, { foreignKey: 'owner_id', as: 'ownedLeads' });
models.LeadStatus.hasMany(models.Lead, { foreignKey: 'status_id', as: 'leads' });
models.LeadSource.hasMany(models.Lead, { foreignKey: 'source_id', as: 'leads' });

models.Lead.hasMany(models.LeadAssignment, { foreignKey: 'lead_id', as: 'assignments' });
models.Lead.hasMany(models.LeadActivity,{foreignKey:'leadId',as:'activities'});models.LeadActivity.belongsTo(models.Lead,{foreignKey:'leadId',as:'lead'});models.LeadActivity.belongsTo(models.User,{foreignKey:'actorUserId',as:'actor'});models.Lead.belongsTo(models.LostReason,{foreignKey:'lost_reason_id',as:'lostReason'});
models.User.hasMany(models.LeadAssignment, { foreignKey: 'assigned_to', as: 'leadAssignments' });

models.Contact.hasMany(models.Conversation, { foreignKey: 'contact_id', as: 'conversations' });
models.Lead.hasMany(models.Conversation, { foreignKey: 'lead_id', as: 'conversations' });

const messageConversationForeignKey = { name: 'conversationId', field: 'conversation_id' };
const messageReplyForeignKey = { name: 'replyToMessageId', field: 'reply_to_message_id' };
models.Conversation.hasMany(models.Message, { foreignKey: messageConversationForeignKey, as: 'messages' });
models.Message.belongsTo(models.Conversation, { foreignKey: messageConversationForeignKey, as: 'conversation' });
models.Message.belongsTo(models.Message, { foreignKey: messageReplyForeignKey, as: 'replyToMessage' });
models.Message.hasMany(models.Message, { foreignKey: messageReplyForeignKey, as: 'messageReplies' });
models.Message.belongsTo(models.User, { foreignKey: 'sentByUserId', as: 'sentBy' });
models.User.hasMany(models.Message, { foreignKey: 'sentByUserId', as: 'sentMessages' });
models.User.hasMany(models.Conversation, { foreignKey: 'assigned_user_id', as: 'assignedConversations' });
models.CommissionRule.hasMany(models.CommissionTier,{foreignKey:'commission_rule_id',as:'tiers'}); models.CommissionTier.belongsTo(models.CommissionRule,{foreignKey:'commission_rule_id',as:'rule'});
models.AgentCommission.belongsTo(models.User,{foreignKey:'agent_user_id',as:'agent'}); models.AgentCommission.belongsTo(models.Student,{foreignKey:'student_id',as:'student'}); models.AgentCommission.belongsTo(models.Course,{foreignKey:'course_id',as:'course'}); models.AgentCommission.belongsTo(models.CommissionRule,{foreignKey:'commission_rule_id',as:'rule'});
models.CommissionPayoutBatch.hasMany(models.CommissionPayoutItem,{foreignKey:'payout_batch_id',as:'items'}); models.CommissionPayoutItem.belongsTo(models.CommissionPayoutBatch,{foreignKey:'payout_batch_id',as:'batch'});
models.Conversation.hasMany(models.ConversationAssignmentHistory, { foreignKey: 'conversation_id', as: 'assignmentHistory' });
models.ConversationAssignmentHistory.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
models.ConversationAssignmentHistory.belongsTo(models.User, { foreignKey: 'previous_user_id', as: 'previousUser' });
models.ConversationAssignmentHistory.belongsTo(models.User, { foreignKey: 'new_user_id', as: 'newUser' });
models.ConversationAssignmentHistory.belongsTo(models.User, { foreignKey: 'changed_by_user_id', as: 'changedBy' });
models.Role.hasMany(models.Conversation, { foreignKey: 'assigned_role_id', as: 'assignedConversations' });

models.Conversation.belongsToMany(models.Label, {
  through: models.ConversationLabel,
  as: 'labels',
  foreignKey: 'conversation_id',
  otherKey: 'label_id'
});

models.User.hasMany(models.UserPermissionOverride, { foreignKey: 'user_id', as: 'permissionOverrides' });
models.UserPermissionOverride.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
models.Permission.hasMany(models.UserPermissionOverride, { foreignKey: 'permission_id', as: 'userOverrides' });
models.UserPermissionOverride.belongsTo(models.Permission, { foreignKey: 'permission_id', as: 'permission' });
models.Label.belongsToMany(models.Conversation, {
  through: models.ConversationLabel,
  as: 'conversations',
  foreignKey: 'label_id',
  otherKey: 'conversation_id'
});
models.Conversation.hasMany(models.ConversationNote, { foreignKey: 'conversation_id', as: 'notes' });
models.Conversation.hasMany(models.Media, { foreignKey: 'conversation_id', as: 'media' });
models.Message.hasOne(models.Media, { foreignKey: 'message_id', as: 'media' });
models.Contact.hasMany(models.WhatsAppComplianceLog, { foreignKey: 'contact_id', as: 'complianceLogs' });
models.WhatsAppTemplate.hasMany(models.WhatsAppComplianceLog, { foreignKey: 'template_id', as: 'complianceLogs' });

models.Campaign.hasMany(models.CampaignRecipient, { foreignKey: 'campaign_id', as: 'recipients' });
models.Campaign.hasMany(models.CampaignEvent, { foreignKey: 'campaign_id', as: 'events' });
models.CampaignRecipient.hasMany(models.CampaignEvent, { foreignKey: 'recipient_id', as: 'events' });
models.Workflow.hasMany(models.WorkflowStep, { foreignKey: 'workflow_id', as: 'steps' });
models.Workflow.hasMany(models.WorkflowRun, { foreignKey: 'workflow_id', as: 'runs' });
models.Appointment.hasMany(models.AppointmentRequest, { foreignKey: 'appointment_id', as: 'requests' });
models.Course.hasMany(models.Batch, { foreignKey: 'course_id', as: 'batches' });
models.Course.hasMany(models.Student, { foreignKey: 'course_id', as: 'students' });
models.Batch.hasMany(models.Student, { foreignKey: 'batch_id', as: 'students' });
models.Student.hasMany(models.StudentGuardian, { foreignKey: 'student_id', as: 'guardians' });
models.Student.hasMany(models.AttendanceAlert, { foreignKey: 'student_id', as: 'attendanceAlerts' });
models.Student.hasMany(models.BirthdayWish, { foreignKey: 'student_id', as: 'birthdayWishes' });
models.AttendanceRecord.hasMany(models.AttendanceAlert, { foreignKey: 'attendance_record_id', as: 'alerts' });
models.Batch.hasMany(models.ClassReminder, { foreignKey: 'batch_id', as: 'classReminders' });
models.Student.hasMany(models.ClassReminder, { foreignKey: 'student_id', as: 'classReminders' });
models.Student.hasMany(models.StudentFee, { foreignKey: 'student_id', as: 'fees' });
models.StudentEnrollment.hasMany(models.StudentFee, { foreignKey: 'enrollment_id', as: 'fees' });
models.StudentFee.hasMany(models.FeeInstallment, { foreignKey: { name: 'studentFeeId', field: 'fee_id' }, as: 'installments' });
models.Student.hasMany(models.FeeReminder, { foreignKey: 'student_id', as: 'feeReminders' });
models.StudentFee.hasMany(models.FeeReminder, { foreignKey: 'student_fee_id', as: 'reminders' });
models.FeeInstallment.hasMany(models.FeeReminder, { foreignKey: 'installment_id', as: 'reminders' });
models.Student.hasMany(models.AttendanceRecord, { foreignKey: 'student_id', as: 'attendance' });
models.StudentEnrollment.hasMany(models.AttendanceRecord, { foreignKey: 'enrollment_id', as: 'attendance' });
models.Student.hasMany(models.Certificate, { foreignKey: 'student_id', as: 'certificates' });
models.StudentEnrollment.hasMany(models.Certificate, { foreignKey: 'enrollment_id', as: 'certificates' });
models.Student.hasMany(models.StudentNote, { foreignKey: 'student_id', as: 'profileNotes' });
models.Student.hasMany(models.StudentDocument, { foreignKey: 'student_id', as: 'documents' });
models.Course.hasMany(models.LmsCourse, { foreignKey: 'course_id', as: 'lmsCourseScopes' });
models.Batch.hasMany(models.LmsCourse, { foreignKey: 'batch_id', as: 'lmsCourseScopes' });
models.LmsCourse.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
models.LmsCourse.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
models.LmsCourse.belongsTo(models.User, { foreignKey: 'instructor_id', as: 'instructor' });
models.LmsCourse.hasMany(models.LmsTopic, { foreignKey: 'lms_course_id', as: 'topics' });
models.LmsCourse.hasMany(models.LmsLesson, { foreignKey: 'lms_course_id', as: 'lessons' });
models.Course.hasMany(models.LmsLesson, { foreignKey: 'course_id', as: 'lmsLessons' });
models.Course.hasMany(models.LmsTopic, { foreignKey: 'course_id', as: 'topics' });
models.LmsTopic.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
models.LmsTopic.belongsTo(models.LmsCourse, { foreignKey: 'lms_course_id', as: 'lmsCourse' });
models.LmsTopic.hasMany(models.LmsLesson, { foreignKey: 'topic_id', as: 'lessons' });
models.LmsLesson.belongsTo(models.LmsCourse, { foreignKey: 'lms_course_id', as: 'lmsCourse' });
models.LmsLessonBatchOverride.belongsTo(models.LmsLesson, { foreignKey: 'lesson_id', as: 'lesson' });
models.LmsLessonBatchOverride.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
models.Batch.hasMany(models.LmsLesson, { foreignKey: 'batch_id', as: 'lmsLessons' });
models.LmsLesson.hasMany(models.LmsLessonMaterial, { foreignKey: 'lesson_id', as: 'materials' });
models.LmsLesson.hasMany(models.LmsLessonComment, { foreignKey: 'lesson_id', as: 'comments' });
models.Student.hasMany(models.LmsLessonComment, { foreignKey: 'student_id', as: 'lessonComments' });
models.LmsLesson.hasMany(models.LmsStudentProgress, { foreignKey: 'lesson_id', as: 'progress' });
models.Student.hasMany(models.LmsStudentProgress, { foreignKey: 'student_id', as: 'lmsProgress' });
models.Student.hasMany(models.StudentPortalSession, { foreignKey: 'student_id', as: 'portalSessions' });
models.Student.hasMany(models.StudentEnrollment, { foreignKey: 'student_id', as: 'enrollments' });
models.Course.hasMany(models.StudentEnrollment, { foreignKey: 'course_id', as: 'studentEnrollments' });
models.Batch.hasMany(models.StudentEnrollment, { foreignKey: 'batch_id', as: 'studentEnrollments' });
models.Student.hasMany(models.StudentAutomationDispatch, { foreignKey: 'student_id', as: 'automationDispatches' });
models.Student.hasMany(models.LmsLiveClassJoin, { foreignKey: 'student_id', as: 'liveClassJoins' });
models.LmsLesson.hasMany(models.LmsLiveClassJoin, { foreignKey: 'lesson_id', as: 'joinLogs' });
models.User.hasMany(models.Notification, { foreignKey: 'user_id', as: 'notifications' });
models.User.hasMany(models.AuthSession, { foreignKey: 'user_id', as: 'authSessions' });
models.AuthSession.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
models.User.hasMany(models.AuditLog, { foreignKey: 'user_id', as: 'auditLogs' });
models.User.hasMany(models.MessageQueue, { foreignKey: 'created_by', as: 'queuedMessages' });
const conversationWhatsappAccountForeignKey = { name: 'whatsappAccountId', field: 'whatsapp_account_id' };
const messageWhatsappAccountForeignKey = { name: 'whatsappAccountId', field: 'whatsapp_account_id' };
models.WhatsAppAccount.hasMany(models.Conversation, { foreignKey: conversationWhatsappAccountForeignKey, as: 'conversations' });
models.WhatsAppAccount.hasMany(models.Message, { foreignKey: messageWhatsappAccountForeignKey, as: 'messages' });
[
  models.Contact, models.Lead, models.WhatsAppTemplate,
  models.Campaign, models.CampaignRecipient, models.MessageQueue, models.Flow, models.FlowRun,
  models.AutoReply, models.WhatsAppComplianceLog
].forEach((model) => {
  model.belongsTo(models.WhatsAppAccount, { foreignKey: 'whatsapp_account_id', as: 'whatsappAccount' });
});
models.Conversation.belongsTo(models.WhatsAppAccount, { foreignKey: conversationWhatsappAccountForeignKey, as: 'whatsappAccount' });
models.Message.belongsTo(models.WhatsAppAccount, { foreignKey: messageWhatsappAccountForeignKey, as: 'whatsappAccount' });

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

module.exports = (sequelize, D) => sequelize.define('PaymentSlip', {
  id: { type: D.BIGINT, autoIncrement: true, primaryKey: true }, studentId: D.BIGINT, leadId: D.BIGINT, contactId: D.BIGINT,
  conversationId: D.BIGINT, whatsappMessageId: D.BIGINT, whatsappAccountId: D.BIGINT, studentFeeId: D.BIGINT,
  feeInstallmentId: D.BIGINT, source: { type: D.STRING(30), allowNull: false, defaultValue: 'WHATSAPP' }, mediaId: D.BIGINT,
  fileUrl: D.STRING(512), originalFilename: D.STRING(255), mimeType: D.STRING(150), fileSize: D.BIGINT,
  fileHash: D.STRING(64), perceptualHash: D.STRING(128), messageCaption: D.TEXT, detectionConfidence: D.DECIMAL(5, 4),
  detectionSignals: { type: D.JSON, allowNull: false, defaultValue: [] }, detectionWarnings: { type: D.JSON, allowNull: false, defaultValue: [] },
  matchCandidates: { type: D.JSON, allowNull: false, defaultValue: {} }, submittedAmount: D.DECIMAL(15, 2), detectedAmount: D.DECIMAL(15, 2),
  confirmedAmount: D.DECIMAL(15, 2), detectedBank: D.STRING(180), destinationBankAccount: D.STRING(80), referenceNumber: D.STRING(180),
  transactionDate: D.DATEONLY, transactionTime: D.TIME, payerName: D.STRING(180), ocrRawText: D.TEXT, ocrData: D.JSON,
  ocrConfidence: D.DECIMAL(5, 4), verificationStatus: { type: D.STRING(30), allowNull: false, defaultValue: 'PENDING' },
  rejectionReason: D.TEXT, reviewerNote: D.TEXT, reviewedByUserId: D.BIGINT, reviewedAt: D.DATE,
  approvedPaymentId: D.BIGINT, duplicateOfSlipId: D.BIGINT, acknowledgementQueuedAt: D.DATE,
  decisionAcknowledgementQueuedAt: D.DATE, deletedAt: D.DATE
}, { tableName: 'payment_slips', timestamps: true, paranoid: true, underscored: true });

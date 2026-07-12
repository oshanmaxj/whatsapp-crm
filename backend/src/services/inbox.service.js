const fs = require('fs');
const path = require('path');
const { Op, fn, col, literal } = require('sequelize');
const logger = require('../config/logger');
const whatsappService = require('./whatsapp.service');
const assignmentNotificationService = require('./assignmentNotification.service');
const auditService = require('./audit.service');
const conversationAccessService = require('./conversationAccess.service');
const {
  sequelize,
  Contact,
  Conversation,
  ConversationLabel,
  ConversationNote,
  Label,
  Lead,
  LeadSource,
  LeadStatus,
  Media,
  Message,
  MessageTemplate,
  Role,
  User,
  WhatsAppAccount,
  ConversationAssignmentHistory
} = require('../models');

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'media');

function ensureUploadDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function normalizeWhatsAppNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

function serializeAgent(agent) {
  if (!agent) return null;
  const roles = agent.roles || [];
  const primaryRole = roles[0] || null;
  return {
    id: agent.id,
    firstName: agent.firstName,
    lastName: agent.lastName,
    name: [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email,
    email: agent.email,
    phone: agent.phone || null,
    status: agent.status,
    active: agent.status === 'active',
    role: primaryRole ? { id: primaryRole.id, name: primaryRole.name } : null,
    department: primaryRole ? { id: primaryRole.id, name: primaryRole.name } : null,
    roles
  };
}
function displayName(person, fallback = 'Unknown') { return person ? ([person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || fallback) : fallback; }

function calculateInteractionRate(messagesSent, repliesReceived) {
  const sent = Number(messagesSent || 0);
  const received = Number(repliesReceived || 0);
  const precisePercentage = sent > 0 ? (received / sent) * 100 : 0;
  return {
    messagesSent: sent,
    repliesReceived: received,
    percentage: Math.round(precisePercentage),
    precisePercentage: Math.round(precisePercentage * 10) / 10
  };
}

async function resolveReplyContext(conversationId, replyToMessageId) {
  if (!replyToMessageId) return { replyToMessageId: null, replyToWhatsappMessageId: null };
  const original = await Message.findOne({
    where: { id: replyToMessageId, conversationId },
    attributes: ['id', 'whatsappMessageId']
  });
  if (!original) {
    const error = new Error('Reply target message not found');
    error.status = 404;
    throw error;
  }
  if (!original.whatsappMessageId) {
    const error = new Error('Reply target does not have a WhatsApp message id yet');
    error.status = 409;
    throw error;
  }
  return {
    replyToMessageId: original.id,
    replyToWhatsappMessageId: original.whatsappMessageId
  };
}

function serializeConversation(conversation) {
  const json = conversation.toJSON ? conversation.toJSON() : conversation;
  const { messages, ...conversationData } = json;
  const messagesSent = Number(json.messagesSent || 0);
  const repliesReceived = Number(json.repliesReceived || 0);
  return {
    ...conversationData,
    assignee: serializeAgent(json.assignee),
    assignedUser: serializeAgent(json.assignedUser || json.assignee),
    assignedTo: json.assignedUserId,
    assigned_user_id: json.assignedUserId,
    assigned_role_id: json.assignedRoleId,
    unreadCount: Number(json.unreadCount || 0),
    lastMessage: messages?.[0] || null,
    interactionRate: calculateInteractionRate(messagesSent, repliesReceived)
  };
}

class InboxService {
  conversationAttributes() {
    return {
      include: [
        [
          literal('(SELECT COUNT(*) FROM messages WHERE messages.conversation_id = "Conversation"."id" AND messages.direction = \'inbound\' AND messages.is_read = false AND messages.deleted_at IS NULL)'),
          'unreadCount'
        ],
        [
          literal('(SELECT MAX(messages.created_at) FROM messages WHERE messages.conversation_id = "Conversation"."id" AND (messages.direction = \'inbound\' OR messages.status = \'received\') AND messages.deleted_at IS NULL)'),
          'lastInboundAt'
        ]
      ]
    };
  }

  async attachInteractionRates(conversations) {
    const conversationIds = conversations.map((conversation) => conversation.id).filter(Boolean);
    if (conversationIds.length === 0) return conversations;

    const counts = await Message.findAll({
      where: {
        conversationId: { [Op.in]: conversationIds }
      },
      attributes: [
        ['conversation_id', 'conversationId'],
        [
          literal("SUM(CASE WHEN (direction = 'outbound' OR status IN ('sent', 'delivered', 'read', 'queued')) AND status <> 'failed' AND COALESCE(is_internal_notification, false) = false THEN 1 ELSE 0 END)"),
          'messagesSent'
        ],
        [
          literal("SUM(CASE WHEN direction = 'inbound' OR status = 'received' THEN 1 ELSE 0 END)"),
          'repliesReceived'
        ]
      ],
      group: ['conversation_id'],
      raw: true
    });

    const statsByConversation = new Map(conversationIds.map((id) => [String(id), { messagesSent: 0, repliesReceived: 0 }]));
    for (const row of counts) {
      const conversationId = row.conversationId || row.conversation_id;
      statsByConversation.set(String(conversationId), {
        messagesSent: Number(row.messagesSent || 0),
        repliesReceived: Number(row.repliesReceived || 0)
      });
    }

    return conversations.map((conversation) => {
      const stats = statsByConversation.get(String(conversation.id)) || {};
      return {
        ...conversation,
        interactionRate: calculateInteractionRate(stats.messagesSent, stats.repliesReceived)
      };
    });
  }

  conversationIncludes() {
    return [
      { model: Contact, as: 'contact', required: false },
      {
        model: Lead,
        as: 'lead',
        required: false,
        include: [
          { model: LeadStatus, as: 'status', required: false },
          { model: LeadSource, as: 'source', required: false },
          { model: User, as: 'owner', attributes: ['id', 'firstName', 'lastName', 'email'], required: false }
        ]
      },
      { model: User, as: 'assignee', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
      { model: User, as: 'assignedUser', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
      { model: Role, as: 'assignedRole', attributes: ['id', 'name', 'description'], required: false },
      { model: WhatsAppAccount, as: 'whatsappAccount', attributes: ['id', 'name', 'phoneNumber', 'phoneNumberId'], required: false },
      { model: Label, as: 'labels', through: { attributes: [] }, required: false }
    ];
  }

  async listConversations({
    search,
    assignedTo,
    assigned_to,
    assignedUserId,
    assigned_user_id,
    assignedRoleId,
    assigned_role_id,
    mine,
    status,
    unread,
    whatsappAccountId
  } = {}, userOrId) {
    const userId = typeof userOrId === 'object' ? userOrId.id : userOrId;
    const filters = {};
    const requestedAssignee = assignedUserId || assigned_user_id || assignedTo || assigned_to;
    const requestedRole = assignedRoleId || assigned_role_id;
    if (requestedAssignee) filters.assignedUserId = requestedAssignee;
    if (requestedRole) filters.assignedRoleId = requestedRole;
    if (mine === 'assigned') filters.assignedUserId = userId;
    if (['role', 'department'].includes(mine)) {
      const currentUser = await User.findByPk(userId, {
        include: [{ model: Role, as: 'roles', attributes: ['id'], through: { attributes: [] } }]
      });
      const roleIds = (currentUser?.roles || []).map((role) => role.id);
      if (roleIds.length) filters.assignedRoleId = { [Op.in]: roleIds };
      else filters.id = null;
    }
    if (status) filters.status = status;
    if (whatsappAccountId) filters.whatsappAccountId = whatsappAccountId;
    const where = await conversationAccessService.scopedWhere(userOrId, filters);

    const contactWhere = {};
    if (search) {
      const term = `%${search}%`;
      contactWhere[Op.or] = [
        { firstName: { [Op.iLike]: term } },
        { lastName: { [Op.iLike]: term } },
        { phone: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        sequelize.where(fn('concat', col('contact.first_name'), ' ', col('contact.last_name')), { [Op.iLike]: term })
      ];
    }

    const conversations = await Conversation.findAll({
      attributes: this.conversationAttributes(),
      where,
      include: this.conversationIncludes().map((include) =>
        include.as === 'contact'
          ? { ...include, where: contactWhere, required: !!search }
          : include
      ),
      order: [['last_message_at', 'DESC NULLS LAST'], ['updated_at', 'DESC']]
    });

    const serialized = conversations.map(serializeConversation);
    const conversationIds = serialized.map((conversation) => conversation.id).filter(Boolean);
    const latestByConversation = new Map();

    if (conversationIds.length > 0) {
      const recentMessages = await Message.findAll({
        where: { conversationId: { [Op.in]: conversationIds } },
        order: [['created_at', 'DESC']],
        attributes: ['id', 'conversationId', 'direction', 'type', 'messageType', 'text', 'templateName', 'mediaUrl', 'status', 'isInternalNotification', 'createdAt']
      });

      for (const message of recentMessages) {
        const conversationId = String(message.conversationId);
        if (!latestByConversation.has(conversationId)) {
          latestByConversation.set(conversationId, message);
        }
      }
    }

    const withLatestMessages = serialized.map((conversation) => ({
      ...conversation,
      lastMessage: latestByConversation.get(String(conversation.id)) || null
    }));
    const withInteractionRates = await this.attachInteractionRates(withLatestMessages);
    return unread === 'true'
      ? withInteractionRates.filter((item) => item.unreadCount > 0)
      : withInteractionRates;
  }

  async listAssignableUsers({ roleId = null, departmentId = null, includeAll = true } = {}) {
    const requestedRoleId = roleId || departmentId || null;
    const include = [{
      model: Role,
      as: 'roles',
      attributes: ['id', 'name', 'description'],
      through: { attributes: [] },
      required: Boolean(requestedRoleId && !includeAll),
      ...(requestedRoleId && !includeAll ? { where: { id: requestedRoleId, isActive: true } } : {})
    }];
    const users = await User.findAll({
      where: { status: 'active' },
      include,
      attributes: ['id', 'firstName', 'lastName', 'email', 'phone', 'status', 'receiveAssignmentNotifications'],
      order: [['firstName', 'ASC'], ['lastName', 'ASC'], ['email', 'ASC']]
    });
    return users.map(serializeAgent);
  }

  async getConversation(id, userOrId) {
    const userId = typeof userOrId === 'object' ? userOrId.id : userOrId;
    await conversationAccessService.assertConversationAccess(id, userOrId);
    const conversation = await Conversation.findByPk(id, {
      attributes: this.conversationAttributes(),
      include: [
        ...this.conversationIncludes(),
        { model: ConversationNote, as: 'notes', include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName', 'email'] }] },
        { model: Media, as: 'media' }
      ]
    });
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }
    const [withInteractionRate] = await this.attachInteractionRates([serializeConversation(conversation)]);
    return withInteractionRate;
  }

  async updateConversation(id, payload, userId) {
    await conversationAccessService.assertConversationAccess(id, userId);
    const conversation = await Conversation.findByPk(id);
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }
    await conversation.update(payload);
    return this.getConversation(id, userId);
  }

  async assignConversation(id, payload = {}, actor) {
    const userId = actor?.id;
    const permissions = new Set(actor?.permissions || []);
    const allowed = (code) => actor?.isSystemAdmin || permissions.has(code);
    const current = await Conversation.findByPk(id, { attributes: ['id', 'assignedUserId', 'assignedRoleId'] });
    if (!current) throw Object.assign(new Error('Conversation not found'), { status: 404 });

    const updates = {};
    const hasAssignedUserId = ['assigned_user_id', 'assignedUserId', 'assigned_to', 'assignedTo']
      .some((key) => Object.prototype.hasOwnProperty.call(payload, key));
    const hasAssignedRoleId = ['assigned_role_id', 'assignedRoleId']
      .some((key) => Object.prototype.hasOwnProperty.call(payload, key));
    if (!hasAssignedUserId && !hasAssignedRoleId) {
      throw Object.assign(new Error('Provide assigned_user_id and/or assigned_role_id'), { status: 422 });
    }

    if (hasAssignedUserId) {
      const assignedUserId = payload.assigned_user_id
        ?? payload.assignedUserId
        ?? payload.assigned_to
        ?? payload.assignedTo
        ?? null;
      if (assignedUserId !== null && !await User.findOne({ where: { id: assignedUserId, status: 'active' }, attributes: ['id'] })) {
        throw Object.assign(new Error('Assigned user not found or inactive'), { status: 422 });
      }
      updates.assignedUserId = assignedUserId;
    }
    if (hasAssignedRoleId) {
      const assignedRoleId = payload.assigned_role_id ?? payload.assignedRoleId ?? null;
      if (assignedRoleId !== null && !await Role.findOne({ where: { id: assignedRoleId, isActive: true }, attributes: ['id'] })) {
        throw Object.assign(new Error('Assigned role/department not found'), { status: 422 });
      }
      updates.assignedRoleId = assignedRoleId;
    }

    const assignedUserChanged = Object.prototype.hasOwnProperty.call(updates, 'assignedUserId') && String(current.assignedUserId ?? '') !== String(updates.assignedUserId ?? '');
    const departmentChanged = Object.prototype.hasOwnProperty.call(updates, 'assignedRoleId')
      && String(current.assignedRoleId ?? '') !== String(updates.assignedRoleId ?? '');

    const previousOwnerId = current.assignedUserId || null;
    const newOwnerId = Object.prototype.hasOwnProperty.call(updates, 'assignedUserId') ? updates.assignedUserId : previousOwnerId;
    const expectedOwner = payload.expected_assigned_user_id ?? payload.expectedAssignedUserId;
    if (expectedOwner !== undefined && String(expectedOwner ?? '') !== String(previousOwnerId ?? '')) throw Object.assign(new Error('Conversation owner changed; reload and try again.'), { status: 409, code: 'STALE_ASSIGNMENT_UPDATE' });
    let action = null;
    if (assignedUserChanged) {
      if (!previousOwnerId && newOwnerId && String(newOwnerId) === String(userId)) {
        if (!allowed('conversation.claim_unassigned')) throw Object.assign(new Error('You cannot claim unassigned conversations.'), { status: 403, code: 'REASSIGN_PERMISSION_REQUIRED' });
        action = 'CLAIMED';
      } else if (previousOwnerId) {
        if (!newOwnerId && !allowed('conversation.unassign')) throw Object.assign(new Error('You cannot unassign this conversation.'), { status: 403, code: 'REASSIGN_PERMISSION_REQUIRED' });
        if (newOwnerId && !allowed('conversation.reassign')) throw Object.assign(new Error('This conversation is owned by another agent.'), { status: 403, code: String(previousOwnerId) === String(userId) ? 'REASSIGN_PERMISSION_REQUIRED' : 'CONVERSATION_OWNED_BY_ANOTHER_AGENT' });
        action = newOwnerId ? 'REASSIGNED' : 'UNASSIGNED';
      } else {
        if (!allowed('conversation.reassign')) throw Object.assign(new Error('Assignment permission is required.'), { status: 403, code: 'REASSIGN_PERMISSION_REQUIRED' });
        action = 'ASSIGNED';
      }
      if (['REASSIGNED', 'UNASSIGNED'].includes(action) && !String(payload.reason || '').trim()) throw Object.assign(new Error('A reassignment reason is required.'), { status: 422, code: 'REASSIGN_REASON_REQUIRED' });
    }
    if (departmentChanged && previousOwnerId && String(previousOwnerId) !== String(userId) && !allowed('conversation.reassign')) throw Object.assign(new Error('This conversation is owned by another agent.'), { status: 403, code: 'CONVERSATION_OWNED_BY_ANOTHER_AGENT' });
    await sequelize.transaction(async (transaction) => {
      const locked = await Conversation.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (String(locked.assignedUserId ?? '') !== String(previousOwnerId ?? '')) throw Object.assign(new Error(locked.assignedUserId ? 'Conversation is already assigned.' : 'Conversation owner changed.'), { status: 409, code: locked.assignedUserId ? 'CONVERSATION_ALREADY_ASSIGNED' : 'STALE_ASSIGNMENT_UPDATE' });
      await locked.update(updates, { transaction });
      if (action) {
        await ConversationAssignmentHistory.create({ conversationId: id, previousUserId: previousOwnerId, newUserId: newOwnerId, changedByUserId: userId, reason: String(payload.reason || '').trim() || null, action }, { transaction });
        const names = await User.findAll({ where: { id: [previousOwnerId, newOwnerId, userId].filter(Boolean) }, attributes: ['id','firstName','lastName','email'], transaction });
        const name = (uid) => { const row = names.find((item) => String(item.id) === String(uid)); return row ? displayName(row, 'Unknown') : 'Unassigned'; };
        const text = action === 'REASSIGNED' ? `Conversation reassigned from ${name(previousOwnerId)} to ${name(newOwnerId)} by ${name(userId)}. Reason: ${payload.reason}` : `Conversation ${action.toLowerCase()} by ${name(userId)}${payload.reason ? `. Reason: ${payload.reason}` : ''}.`;
        await Message.create({ conversationId: id, contactId: locked.contactId, whatsappAccountId: locked.whatsappAccountId, sentByUserId: userId, channel: 'system', messageType: 'assignment_event', isInternalNotification: true, direction: 'outbound', type: 'text', text, status: 'sent', statusUpdatedAt: new Date() }, { transaction });
      }
    });
    if (action) await auditService.record({ userId, action: `CONVERSATION_${action}`, entityType: 'conversation', entityId: id, method: 'POST', path: `/api/conversations/${id}/assign`, changes: { contactId: current.contactId, previousAssignedUserId: previousOwnerId, newAssignedUserId: newOwnerId, reason: payload.reason || null } });
    const result = await this.getConversation(id, userId);

    if (assignedUserChanged || departmentChanged) {
      try {
        const [assignedUser, department, assignedBy] = await Promise.all([
          result.assignedUserId
            ? User.findByPk(result.assignedUserId, {
                attributes: ['id', 'firstName', 'lastName', 'email', 'phone', 'receiveAssignmentNotifications']
              })
            : null,
          result.assignedRoleId ? Role.findByPk(result.assignedRoleId) : null,
          User.findByPk(userId, { attributes: ['id', 'firstName', 'lastName', 'email'] })
        ]);
        await assignmentNotificationService.sendAssignmentNotification({
          conversation: result,
          assignedUser,
          department,
          assignedBy,
          assignedUserChanged,
          departmentChanged,
          notifyAssignedUser: payload.notify_assigned_user !== false && payload.notifyAssignedUser !== false
        });
      } catch (error) {
        logger.warn('assignment_notification_processing_failed', {
          conversationId: id,
          error: error.message
        });
      }
    }
    return result;
  }

  async setLabels(conversationId, labels = [], userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }
    const labelRows = [];
    for (const item of labels) {
      const [label] = await Label.findOrCreate({
        where: { name: item.name || item },
        defaults: { color: item.color || '#25d366' }
      });
      labelRows.push(label);
    }
    await ConversationLabel.destroy({ where: { conversationId } });
    for (const label of labelRows) {
      await ConversationLabel.findOrCreate({
        where: { conversationId, labelId: label.id },
        defaults: { conversationId, labelId: label.id }
      });
    }
    return this.getConversation(conversationId, userId);
  }

  async createNote({ conversationId, createdBy, type = 'private', note }, userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    const row = await ConversationNote.create({ conversationId, createdBy, type, note });
    return ConversationNote.findByPk(row.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName', 'email'] }]
    });
  }

  async listNotes(conversationId, userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    return ConversationNote.findAll({
      where: { conversationId },
      include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      order: [['created_at', 'DESC']]
    });
  }

  async createMedia({ conversationId, uploadedBy, fileName, mimeType, mediaType, dataBase64, caption, replyToMessageId = null }, userId) {
    if (!conversationId || !fileName || !mimeType || !mediaType || !dataBase64) {
      const error = new Error('Conversation, file name, MIME type, media type, and file data are required');
      error.status = 400;
      throw error;
    }
    await conversationAccessService.assertConversationAccess(conversationId, userId);

    const conversation = await Conversation.findByPk(conversationId, {
      include: [{
        model: Contact,
        as: 'contact',
        attributes: ['id', 'phone', 'whatsappId']
      }]
    });
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }

    const toNumber = normalizeWhatsAppNumber(
      conversation.contact?.whatsappId || conversation.contact?.phone
    );
    if (!toNumber) {
      const error = new Error('Conversation contact does not have a WhatsApp number');
      error.status = 400;
      throw error;
    }

    ensureUploadDir();
    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length === 0) {
      const error = new Error('Uploaded media file is empty');
      error.status = 400;
      throw error;
    }
    const safeName = `${Date.now()}-${String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = path.join(uploadDir, safeName);
    fs.writeFileSync(storagePath, buffer);

    const publicUrl = `/uploads/media/${safeName}`;
    logger.info('media_file_stored_locally', {
      conversationId,
      fileName,
      mimeType,
      mediaType,
      size: buffer.length
    });

    const messageType = mediaType === 'pdf'
      ? 'document'
      : mediaType === 'voice'
        ? 'audio'
        : mediaType;
    if (!['image', 'video', 'audio', 'document'].includes(messageType)) {
      const error = new Error('Unsupported WhatsApp media type');
      error.status = 400;
      throw error;
    }
    const replyContext = await resolveReplyContext(conversationId, replyToMessageId);
    const uploadResponse = await whatsappService.uploadMedia({
      filePath: storagePath,
      mimeType,
      whatsappAccountId: conversation.whatsappAccountId
    });
    const metaMediaId = uploadResponse?.id;
    if (!metaMediaId) {
      const error = new Error('Meta media upload did not return a media ID');
      error.status = 502;
      throw error;
    }

    const sendResult = await whatsappService.sendMediaMessage({
      to: toNumber,
      mediaType: messageType,
      mediaId: metaMediaId,
      caption: caption || fileName,
      filename: fileName,
      mimeType,
      contextMessageId: replyContext.replyToWhatsappMessageId,
      log: false,
      returnMetaResponse: true
      , whatsappAccountId: conversation.whatsappAccountId
    });
    const whatsappMessageId = sendResult.message?.id;
    if (!whatsappMessageId) {
      const error = new Error('WhatsApp media send did not return a message ID');
      error.status = 502;
      throw error;
    }
    const runtimeConfig = await whatsappService.getRuntimeConfig(conversation.whatsappAccountId);

    return sequelize.transaction(async (transaction) => {
      const message = await Message.create({
        whatsappMessageId,
        conversationId,
        contactId: conversation.contactId,
        sentByUserId: userId,
        direction: 'outbound',
        type: messageType,
        text: caption || fileName,
        mediaId: metaMediaId,
        mediaUrl: publicUrl,
        fromNumber: runtimeConfig.phoneNumberId || null,
        toNumber,
        status: 'sent',
        whatsappAccountId: conversation.whatsappAccountId || null,
        replyToMessageId: replyContext.replyToMessageId,
        replyToWhatsappMessageId: replyContext.replyToWhatsappMessageId,
        isRead: true,
        rawPayload: {
          file: { fileName, mimeType, mediaType, size: buffer.length },
          metaMediaUpload: uploadResponse,
          whatsappMediaSend: sendResult.responseData
        }
      }, { transaction });

      const media = await Media.create({
        conversationId,
        messageId: message.id,
        uploadedBy,
        fileName: safeName,
        originalName: fileName,
        mimeType,
        mediaType,
        size: buffer.length,
        storagePath,
        publicUrl,
        caption
      }, { transaction });

      await conversation.update({ lastMessageAt: new Date() }, { transaction });
      logger.info('outbound_media_persisted', {
        conversationId,
        messageId: message.id,
        mediaRecordId: media.id,
        metaMediaId,
        whatsappMessageId,
        fromNumber: runtimeConfig.phoneNumberId || null,
        toNumber,
        status: 'sent'
      });
      return media;
    });
  }

  async listMedia(conversationId, userId) {
    if (!conversationId) {
      throw Object.assign(new Error('conversationId is required'), { status: 400 });
    }
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    return Media.findAll({
      where: { conversationId },
      include: [{ model: User, as: 'uploader', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      order: [['created_at', 'DESC']]
    });
  }

  async getMedia(id, userId) {
    const media = await Media.findByPk(id);
    if (!media) {
      const error = new Error('Media not found');
      error.status = 404;
      throw error;
    }
    await conversationAccessService.assertConversationAccess(media.conversationId, userId);
    return media;
  }

  async listLabels() {
    return Label.findAll({ order: [['name', 'ASC']] });
  }

  async createLabel(payload) {
    return Label.create(payload);
  }

  async listTemplates({ category } = {}) {
    return MessageTemplate.findAll({
      where: { active: true, ...(category ? { category } : {}) },
      order: [['category', 'ASC'], ['name', 'ASC']]
    });
  }

  async createTemplate(payload) {
    return MessageTemplate.create(payload);
  }
}

module.exports = new InboxService();

const fs = require('fs');
const path = require('path');
const { Op, fn, col, literal } = require('sequelize');
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
  User
} = require('../models');

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'media');

function ensureUploadDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function serializeAgent(agent) {
  if (!agent) return null;
  return {
    id: agent.id,
    name: [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email,
    email: agent.email
  };
}

function serializeConversation(conversation) {
  const json = conversation.toJSON ? conversation.toJSON() : conversation;
  return {
    ...json,
    assignee: serializeAgent(json.assignee),
    unreadCount: Number(json.unreadCount || 0)
  };
}

class InboxService {
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
      { model: Label, as: 'labels', through: { attributes: [] }, required: false }
    ];
  }

  async listConversations({ search, assignedTo, status, unread } = {}) {
    const where = {};
    if (assignedTo) where.assignedTo = assignedTo;
    if (status) where.status = status;

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
      attributes: {
        include: [
          [
            literal('(SELECT COUNT(*) FROM messages WHERE messages.conversation_id = "Conversation"."id" AND messages.direction = \'inbound\' AND messages.is_read = false AND messages.deleted_at IS NULL)'),
            'unreadCount'
          ]
        ]
      },
      where,
      include: this.conversationIncludes().map((include) =>
        include.as === 'contact'
          ? { ...include, where: contactWhere, required: !!search }
          : include
      ),
      order: [['last_message_at', 'DESC NULLS LAST'], ['updated_at', 'DESC']]
    });

    const serialized = conversations.map(serializeConversation);
    return unread === 'true' ? serialized.filter((item) => item.unreadCount > 0) : serialized;
  }

  async getConversation(id) {
    const conversation = await Conversation.findByPk(id, {
      attributes: {
        include: [
          [
            literal('(SELECT COUNT(*) FROM messages WHERE messages.conversation_id = "Conversation"."id" AND messages.direction = \'inbound\' AND messages.is_read = false AND messages.deleted_at IS NULL)'),
            'unreadCount'
          ]
        ]
      },
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
    return serializeConversation(conversation);
  }

  async updateConversation(id, payload) {
    const conversation = await Conversation.findByPk(id);
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }
    await conversation.update(payload);
    return this.getConversation(id);
  }

  async assignConversation(id, assignedTo) {
    return this.updateConversation(id, { assignedTo });
  }

  async setLabels(conversationId, labels = []) {
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
    return this.getConversation(conversationId);
  }

  async createNote({ conversationId, createdBy, type = 'private', note }) {
    const row = await ConversationNote.create({ conversationId, createdBy, type, note });
    return ConversationNote.findByPk(row.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName', 'email'] }]
    });
  }

  async listNotes(conversationId) {
    return ConversationNote.findAll({
      where: { conversationId },
      include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      order: [['created_at', 'DESC']]
    });
  }

  async createMedia({ conversationId, uploadedBy, fileName, mimeType, mediaType, dataBase64, caption }) {
    ensureUploadDir();
    const buffer = Buffer.from(dataBase64, 'base64');
    const safeName = `${Date.now()}-${String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = path.join(uploadDir, safeName);
    fs.writeFileSync(storagePath, buffer);

    const publicUrl = `/uploads/media/${safeName}`;
    const message = await Message.create({
      conversationId,
      direction: 'outbound',
      type: mediaType === 'pdf' ? 'document' : mediaType === 'voice' ? 'audio' : mediaType,
      text: caption || fileName,
      mediaUrl: publicUrl,
      status: 'sent',
      isRead: true,
      rawPayload: { fileName, mimeType, mediaType }
    });

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
    });

    await Conversation.update({ lastMessageAt: new Date() }, { where: { id: conversationId } });
    return media;
  }

  async listMedia(conversationId) {
    return Media.findAll({
      where: conversationId ? { conversationId } : {},
      include: [{ model: User, as: 'uploader', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      order: [['created_at', 'DESC']]
    });
  }

  async getMedia(id) {
    const media = await Media.findByPk(id);
    if (!media) {
      const error = new Error('Media not found');
      error.status = 404;
      throw error;
    }
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

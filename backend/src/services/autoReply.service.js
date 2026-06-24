const { Op } = require('sequelize');
const { AutoReply } = require('../models');

class AutoReplyService {
  async listReplies() {
    return AutoReply.findAll({ order: [['created_at', 'DESC']] });
  }

  async getReplyById(id) {
    return AutoReply.findByPk(id);
  }

  async createReply(payload) {
    return AutoReply.create(payload);
  }

  async updateReply(id, payload) {
    const reply = await AutoReply.findByPk(id);
    if (!reply) {
      const error = new Error('Auto reply not found');
      error.status = 404;
      throw error;
    }
    return reply.update(payload);
  }

  async deleteReply(id) {
    const reply = await AutoReply.findByPk(id);
    if (!reply) {
      const error = new Error('Auto reply not found');
      error.status = 404;
      throw error;
    }
    await reply.destroy();
    return { id };
  }

  async findReplyForText(text) {
    if (!text || !text.trim()) {
      return null;
    }

    const normalizedText = text.trim().toLowerCase();
    const replies = await AutoReply.findAll({
      where: {
        active: true
      },
      order: [['created_at', 'ASC']]
    });

    for (const reply of replies) {
      const trigger = reply.trigger.toLowerCase();

      if (reply.matchType === 'exact' && normalizedText === trigger) {
        return reply;
      }

      if (reply.matchType === 'contains' && normalizedText.includes(trigger)) {
        return reply;
      }

      if (reply.matchType === 'regex') {
        try {
          const regex = new RegExp(reply.trigger, 'i');
          if (regex.test(text)) {
            return reply;
          }
        } catch (err) {
          continue;
        }
      }
    }

    return null;
  }
}

module.exports = new AutoReplyService();
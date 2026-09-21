const axios = require('axios');
const { FacebookComment, Contact, User } = require('../models');
const facebookConversationIdentityService = require('./facebookConversationIdentity.service');
const facebookPageAccessService = require('./facebookPageAccess.service');
const facebookPageService = require('./facebookPage.service');
const facebookSettingsService = require('./facebookSettings.service');
const leadService = require('./lead.service');
const socketService = require('./socket.service');
const logger = require('../config/logger');

const GRAPH_API_BASE_URL = 'https://graph.facebook.com';

class FacebookCommentService {
  async ingestComment({ facebookPageId, metaCommentId, metaPostId, parentCommentId, psid, displayName, message, createdTime }) {
    const existing = await FacebookComment.findOne({ where: { metaCommentId } });
    if (existing) return { comment: existing, created: false };

    let contact = null;
    let lead = null;
    if (psid) {
      try {
        const resolved = await facebookConversationIdentityService.resolveContactOnly({ facebookPageId, psid, displayName });
        contact = resolved.contact;
        lead = await leadService.getOpenLeadForContactAndFacebookPage(contact.id, facebookPageId);
        if (!lead) lead = await leadService.createLead(contact.id, { source: 'Facebook', facebookPageId });
      } catch (error) {
        logger.warn('facebook_comment_contact_resolution_failed', { facebookPageId, message: error.message });
      }
    }

    const comment = await FacebookComment.create({
      facebookPageId,
      metaCommentId,
      metaPostId,
      parentCommentId: parentCommentId || null,
      facebookPsid: psid || null,
      contactId: contact?.id || null,
      leadId: lead?.id || null,
      message: message || null,
      createdTime: createdTime || new Date()
    });

    logger.info('facebook_comment_created', { facebookPageId, metaCommentId, metaPostId });
    socketService.emit('facebook.comment.received', {
      id: comment.id, facebookPageId, metaCommentId, metaPostId, parentCommentId: comment.parentCommentId, message: comment.message
    });

    setImmediate(() => require('./flow.service').handleDomainEvent({
      eventType: 'facebook_comment_received',
      eventId: metaCommentId,
      channel: 'facebook_comment',
      facebookPageId,
      contactId: contact?.id || null,
      leadId: lead?.id || null,
      commentId: comment.id,
      // Threaded through so a comment-triggered flow can resolve/create a
      // private Messenger conversation on demand (see
      // flow.service.js:executeFacebookMessageNode) without a second,
      // duplicate identity-resolution pass.
      psid: psid || null,
      text: comment.message
    }).catch((error) => logger.warn('facebook_comment_flow_dispatch_failed', { facebookPageId, message: error.message })));

    return { comment, created: true };
  }

  async list({ facebookPageId = null, userId = null } = {}) {
    const accessWhere = userId ? await facebookPageAccessService.whereForUser(userId, 'facebookPageId') : {};
    return FacebookComment.findAll({
      where: { ...(facebookPageId ? { facebookPageId } : {}), ...accessWhere },
      include: [
        { model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName'], required: false },
        { model: User, as: 'assignedUser', attributes: ['id', 'firstName', 'lastName'], required: false }
      ],
      order: [['created_time', 'DESC']],
      limit: 200
    });
  }

  async get(id, userId = null) {
    const comment = await FacebookComment.findByPk(id);
    if (!comment) throw Object.assign(new Error('Comment not found'), { status: 404 });
    if (userId) await facebookPageAccessService.assertAccess(comment.facebookPageId, userId);
    return comment;
  }

  async replyToComment(id, { message } = {}, userId = null) {
    if (!message || !String(message).trim()) throw Object.assign(new Error('Reply message is required'), { status: 400 });
    const comment = await this.get(id, userId);
    if (comment.replied) return comment;

    const config = await facebookPageService.runtimeConfig(comment.facebookPageId, userId);
    const { graphApiVersion } = await facebookSettingsService.getRuntimeConfig();
    try {
      await axios.post(`${GRAPH_API_BASE_URL}/${graphApiVersion}/${comment.metaCommentId}/comments`, null, {
        params: { message, access_token: config.pageAccessToken },
        timeout: 15000
      });
    } catch (error) {
      logger.error('facebook_comment_reply_failed', {
        facebookPageId: comment.facebookPageId,
        commentId: comment.id,
        message: error.response?.data?.error?.message || error.message
      });
      throw Object.assign(new Error(error.response?.data?.error?.message || 'Failed to reply to Facebook comment'), {
        status: 502, code: 'FACEBOOK_COMMENT_REPLY_FAILED', exposeMessage: true
      });
    }

    await comment.update({ replied: true, assignedUserId: comment.assignedUserId || userId || null });
    logger.info('facebook_comment_reply_success', { facebookPageId: comment.facebookPageId, commentId: comment.id });
    socketService.emit('facebook.comment.replied', { id: comment.id, facebookPageId: comment.facebookPageId });
    return comment;
  }

  // Shared low-level Graph call for both manual hide/unhide (hideComment/
  // unhideComment below) and the automatic keyword auto-hide flow
  // (facebookCommentAutoHideRule.service.js) — there is exactly one place
  // in the codebase that ever sets a comment's is_hidden state on Meta.
  // No userId/access check here: callers are expected to have already
  // authorized the request (via get()/assertAccess) or to be an internal
  // system caller (the webhook-triggered auto-hide path).
  async setHiddenState(comment, hidden) {
    const config = await facebookPageService.runtimeConfig(comment.facebookPageId);
    try {
      await facebookPageService.graphRequest(config, 'post', comment.metaCommentId, '', { is_hidden: hidden });
    } catch (error) {
      logger.error('facebook_comment_hide_state_failed', {
        facebookPageId: comment.facebookPageId,
        commentId: comment.id,
        hidden,
        message: error.response?.data?.error?.message || error.message
      });
      throw Object.assign(new Error(error.response?.data?.error?.message || `Failed to ${hidden ? 'hide' : 'unhide'} this Facebook comment`), {
        status: 502, code: 'FACEBOOK_COMMENT_HIDE_FAILED', exposeMessage: true
      });
    }
    await comment.update({ hidden });
    return comment;
  }

  async hideComment(id, userId = null) {
    const comment = await this.get(id, userId);
    if (comment.hidden) return comment; // already hidden — idempotent
    await this.setHiddenState(comment, true);
    logger.info('facebook_comment_manual_hide', { facebookPageId: comment.facebookPageId, commentId: comment.id, userId });
    socketService.emit('facebook.comment.updated', { id: comment.id, facebookPageId: comment.facebookPageId, hidden: true });
    return comment;
  }

  async unhideComment(id, userId = null) {
    const comment = await this.get(id, userId);
    if (!comment.hidden) return comment; // already visible — idempotent
    await this.setHiddenState(comment, false);
    logger.info('facebook_comment_manual_unhide', { facebookPageId: comment.facebookPageId, commentId: comment.id, userId });
    socketService.emit('facebook.comment.updated', { id: comment.id, facebookPageId: comment.facebookPageId, hidden: false });
    return comment;
  }
}

module.exports = new FacebookCommentService();

const { Op } = require('sequelize');
const { FacebookCommentAutoHideRule, AppSetting } = require('../models');
const facebookPageAccessService = require('./facebookPageAccess.service');
const facebookCommentService = require('./facebookComment.service');
const auditService = require('./audit.service');
const logger = require('../config/logger');

const MATCH_TYPES = ['contains', 'exact', 'starts_with', 'ends_with'];
const SETTINGS_NAMESPACE = 'facebook';
const SETTINGS_KEY = 'comment_auto_hide';

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function badRequest(message, code) {
  return Object.assign(new Error(message), { status: 400, code });
}

function validateRulePayload(payload = {}, { partial = false } = {}) {
  const result = {};
  if (!partial || payload.keyword !== undefined) {
    const keyword = clean(payload.keyword);
    if (!keyword) throw badRequest('Keyword is required.', 'FACEBOOK_AUTO_HIDE_KEYWORD_REQUIRED');
    result.keyword = keyword;
  }
  if (!partial || payload.matchType !== undefined) {
    const matchType = clean(payload.matchType) || 'contains';
    if (!MATCH_TYPES.includes(matchType)) throw badRequest(`matchType must be one of: ${MATCH_TYPES.join(', ')}`, 'FACEBOOK_AUTO_HIDE_MATCH_TYPE_INVALID');
    result.matchType = matchType;
  }
  if (!partial || payload.caseSensitive !== undefined) {
    result.caseSensitive = Boolean(payload.caseSensitive);
  }
  if (!partial || payload.enabled !== undefined) {
    result.enabled = payload.enabled === undefined ? true : Boolean(payload.enabled);
  }
  return result;
}

// Deliberately NOT a real regular expression engine — see IMPORTANT MATCHING
// SAFETY in the feature spec: only these four fixed, safe comparison modes
// are supported. Never throws on well-formed inputs; the caller still wraps
// this per-rule so a single unexpected value can never abort evaluation of
// the remaining rules.
function evaluateRule(text, rule) {
  const haystackRaw = String(text || '');
  const needleRaw = String(rule.keyword || '');
  const haystack = rule.caseSensitive ? haystackRaw : haystackRaw.toLowerCase();
  const needle = rule.caseSensitive ? needleRaw : needleRaw.toLowerCase();
  if (!needle) return false;
  switch (rule.matchType) {
    case 'exact': return haystack === needle;
    case 'starts_with': return haystack.startsWith(needle);
    case 'ends_with': return haystack.endsWith(needle);
    case 'contains':
    default: return haystack.includes(needle);
  }
}

async function sanitizeFacebookPageId(facebookPageId, userId) {
  if (facebookPageId === undefined || facebookPageId === null || facebookPageId === '') return null;
  // Never trust a facebookPageId from the client without verifying the
  // caller can actually access that Page — mirrors every other Facebook
  // service's use of facebookPageAccessService.assertAccess.
  if (userId) await facebookPageAccessService.assertAccess(facebookPageId, userId);
  return facebookPageId;
}

async function assertRuleManageAccess(rule, userId) {
  if (!userId) return; // internal/system call
  const context = await facebookPageAccessService.userContext(userId);
  if (context.unrestricted) return;
  if (rule.facebookPageId == null) {
    throw Object.assign(new Error('Only an administrator with unrestricted Facebook Page access can manage a rule that applies to all Pages.'), { status: 403 });
  }
  if (!context.pageIds.includes(String(rule.facebookPageId))) {
    throw Object.assign(new Error('You do not have access to this Facebook Page.'), { status: 403 });
  }
}

class FacebookCommentAutoHideRuleService {
  async settingsRow() {
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: SETTINGS_NAMESPACE, key: SETTINGS_KEY },
      // Safe default: auto-hide ships DISABLED until an admin explicitly
      // opts in — enabling this feature must never suddenly start hiding
      // new comments in an existing deployment.
      defaults: { value: { enabled: false }, isSecret: false }
    });
    return row;
  }

  async isGloballyEnabled() {
    const row = await this.settingsRow();
    return Boolean(row.value?.enabled);
  }

  async getGlobalSettings() {
    return { enabled: await this.isGloballyEnabled() };
  }

  async setGloballyEnabled(enabled, userId = null) {
    const row = await this.settingsRow();
    await row.update({ value: { ...row.value, enabled: Boolean(enabled) }, updatedBy: userId || null });
    await auditService.record({
      userId,
      action: enabled ? 'facebook_comment_auto_hide_enabled' : 'facebook_comment_auto_hide_disabled',
      entityType: 'facebook_comment_auto_hide_settings',
      entityId: String(row.id)
    });
    return { enabled: Boolean(enabled) };
  }

  async listRules({ facebookPageId = null, userId = null } = {}) {
    const where = {};
    if (facebookPageId) {
      await sanitizeFacebookPageId(facebookPageId, userId);
      where.facebookPageId = facebookPageId;
    } else if (userId) {
      const context = await facebookPageAccessService.userContext(userId);
      if (!context.unrestricted) {
        // Restricted users may see global rules (informational — they DO
        // apply to their Pages too) plus rules scoped to Pages they can
        // access, but never another Page's rules.
        where[Op.or] = [{ facebookPageId: null }, { facebookPageId: { [Op.in]: context.pageIds } }];
      }
    }
    return FacebookCommentAutoHideRule.findAll({ where, order: [['createdAt', 'DESC']] });
  }

  async getRule(id, userId = null) {
    const rule = await FacebookCommentAutoHideRule.findByPk(id);
    if (!rule) throw Object.assign(new Error('Auto-hide rule not found'), { status: 404 });
    if (userId) await assertRuleManageAccess(rule, userId);
    return rule;
  }

  async assertNoDuplicate({ keyword, matchType, caseSensitive, facebookPageId, excludeId = null }) {
    const candidates = await FacebookCommentAutoHideRule.findAll({
      where: {
        matchType,
        facebookPageId: facebookPageId ?? null,
        ...(excludeId ? { id: { [Op.ne]: excludeId } } : {})
      }
    });
    const normalizedNew = keyword.toLowerCase();
    const duplicate = candidates.some((rule) => {
      // Two rules that would behave identically (same normalized keyword,
      // same match type, same case-sensitivity, same Page scope) count as
      // an accidental duplicate regardless of casing in the stored keyword.
      if (Boolean(rule.caseSensitive) !== Boolean(caseSensitive)) return false;
      return caseSensitive ? rule.keyword === keyword : rule.keyword.toLowerCase() === normalizedNew;
    });
    if (duplicate) {
      throw Object.assign(new Error('An identical Auto-Hide rule already exists for this Page and match type.'), {
        status: 409, code: 'FACEBOOK_AUTO_HIDE_RULE_DUPLICATE'
      });
    }
  }

  async createRule(payload, userId = null) {
    const fields = validateRulePayload(payload);
    const facebookPageId = await sanitizeFacebookPageId(payload.facebookPageId, userId);
    if (facebookPageId === null && userId) {
      const context = await facebookPageAccessService.userContext(userId);
      if (!context.unrestricted) {
        throw Object.assign(new Error('Only an administrator with unrestricted Facebook Page access can create a rule that applies to all Pages.'), { status: 403 });
      }
    }
    await this.assertNoDuplicate({ ...fields, facebookPageId });
    const rule = await FacebookCommentAutoHideRule.create({ ...fields, facebookPageId, createdBy: userId || null });
    await auditService.record({
      userId, action: 'facebook_comment_auto_hide_rule_created', entityType: 'facebook_comment_auto_hide_rule',
      entityId: String(rule.id), changes: { keyword: fields.keyword, matchType: fields.matchType, facebookPageId }
    });
    return rule;
  }

  async updateRule(id, payload, userId = null) {
    const rule = await this.getRule(id, userId);
    const fields = validateRulePayload(payload, { partial: true });
    let facebookPageId = rule.facebookPageId;
    if (payload.facebookPageId !== undefined) {
      facebookPageId = await sanitizeFacebookPageId(payload.facebookPageId, userId);
      if (facebookPageId === null && userId) {
        const context = await facebookPageAccessService.userContext(userId);
        if (!context.unrestricted) {
          throw Object.assign(new Error('Only an administrator with unrestricted Facebook Page access can make a rule apply to all Pages.'), { status: 403 });
        }
      }
    }
    await this.assertNoDuplicate({
      keyword: fields.keyword ?? rule.keyword,
      matchType: fields.matchType ?? rule.matchType,
      caseSensitive: fields.caseSensitive ?? rule.caseSensitive,
      facebookPageId,
      excludeId: rule.id
    });
    await rule.update({ ...fields, facebookPageId });
    await auditService.record({
      userId, action: 'facebook_comment_auto_hide_rule_updated', entityType: 'facebook_comment_auto_hide_rule',
      entityId: String(rule.id), changes: { ...fields, facebookPageId }
    });
    return rule;
  }

  async setRuleEnabled(id, enabled, userId = null) {
    return this.updateRule(id, { enabled: Boolean(enabled) }, userId);
  }

  async deleteRule(id, userId = null) {
    const rule = await this.getRule(id, userId);
    await rule.destroy();
    await auditService.record({
      userId, action: 'facebook_comment_auto_hide_rule_deleted', entityType: 'facebook_comment_auto_hide_rule', entityId: String(id)
    });
    return { deleted: true };
  }

  // Called from the webhook path right after a comment is ingested, and
  // from retryAutoHide() below. Idempotent: a comment already successfully
  // auto-hidden is never re-sent to Meta, satisfying the requirement that
  // Facebook's at-least-once webhook redelivery must never fire a second
  // hide request for the same comment.
  async evaluateAndHide(comment) {
    if (comment.autoHideStatus === 'hidden') return comment;

    const globallyEnabled = await this.isGloballyEnabled();
    if (!globallyEnabled) return comment;

    const rules = await FacebookCommentAutoHideRule.findAll({
      where: {
        enabled: true,
        [Op.or]: [{ facebookPageId: null }, { facebookPageId: comment.facebookPageId }]
      }
    });

    let matchedRule = null;
    for (const rule of rules) {
      try {
        if (evaluateRule(comment.message, rule)) { matchedRule = rule; break; }
      } catch (error) {
        // A single malformed/unexpected rule must never crash webhook
        // processing — log it and keep evaluating the remaining rules.
        logger.warn('facebook_comment_auto_hide_rule_evaluation_failed', { ruleId: rule.id, message: error.message });
      }
    }

    if (!matchedRule) {
      await comment.update({ autoHideMatched: false, autoHideStatus: 'not_matched' });
      return comment;
    }

    await comment.update({
      autoHideMatched: true,
      autoHideRuleId: matchedRule.id,
      autoHideKeyword: matchedRule.keyword,
      autoHideMatchType: matchedRule.matchType,
      autoHideStatus: 'pending',
      autoHideAttemptedAt: new Date(),
      autoHideError: null
    });

    const outcome = await this.attemptHide(comment);
    if (outcome.success) {
      logger.info('facebook_comment_auto_hidden', { facebookPageId: comment.facebookPageId, commentId: comment.id, ruleId: matchedRule.id });
    } else {
      logger.error('facebook_comment_auto_hide_failed', { facebookPageId: comment.facebookPageId, commentId: comment.id, ruleId: matchedRule.id, message: outcome.error });
    }
    return comment;
  }

  // Shared by the automatic path (swallows failure) and manual retry
  // (rethrows failure) — both ultimately call facebookCommentService's
  // single shared Graph "hide" implementation, never a second one.
  async attemptHide(comment) {
    try {
      await facebookCommentService.setHiddenState(comment, true);
      await comment.update({ autoHideStatus: 'hidden', autoHiddenAt: new Date(), autoHideError: null });
      return { success: true };
    } catch (error) {
      const safeMessage = error.exposeMessage ? error.message : 'Failed to hide this comment via the Meta Graph API.';
      await comment.update({ autoHideStatus: 'failed', autoHideError: safeMessage });
      return { success: false, error: safeMessage };
    }
  }

  async retryAutoHide(commentId, userId = null) {
    const comment = await facebookCommentService.get(commentId, userId);
    if (comment.autoHideStatus === 'hidden') return comment; // already hidden — nothing to retry
    if (comment.autoHideStatus !== 'failed') {
      throw badRequest('This comment does not have a failed auto-hide attempt to retry.', 'FACEBOOK_AUTO_HIDE_RETRY_NOT_APPLICABLE');
    }
    await comment.update({ autoHideStatus: 'pending', autoHideAttemptedAt: new Date(), autoHideError: null });
    const outcome = await this.attemptHide(comment);
    if (!outcome.success) {
      throw Object.assign(new Error(outcome.error), { status: 502, code: 'FACEBOOK_COMMENT_HIDE_FAILED', exposeMessage: true });
    }
    logger.info('facebook_comment_auto_hide_retry_success', { facebookPageId: comment.facebookPageId, commentId: comment.id, userId });
    return comment;
  }
}

module.exports = new FacebookCommentAutoHideRuleService();
module.exports.MATCH_TYPES = MATCH_TYPES;
module.exports.evaluateRule = evaluateRule;

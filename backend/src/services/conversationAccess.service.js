const { Op } = require('sequelize');
const { Conversation, Role, User } = require('../models');
const whatsappAccountAccessService = require('./whatsappAccountAccess.service');

const scopeRank = { assigned_only: 1, role_only: 1, role_and_assigned: 2, all: 3 };

class ConversationAccessService {
  async getUserScope(userId) {
    const user = await User.findByPk(userId, {
      attributes: ['id', 'isSystemAdmin'],
      include: [{
        model: Role,
        as: 'roles',
        attributes: ['id', 'name', 'chatVisibilityScope'],
        required: false
      }]
    });
    if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

    const roles = user.roles || [];
    const privilegedRole = roles.some((role) => ['admin', 'manager'].includes(String(role.name).toLowerCase()));
    if (user.isSystemAdmin || privilegedRole) {
      return { scope: 'all', user };
    }

    const scope = roles.reduce((current, role) => {
      const legacyScope = role.chatVisibilityScope || 'assigned_only';
      const candidate = legacyScope === 'assigned'
        ? 'assigned_only'
        : legacyScope === 'department'
          ? 'role_and_assigned'
          : legacyScope === 'department_only'
            ? 'role_only'
            : legacyScope === 'department_and_assigned'
              ? 'role_and_assigned'
          : legacyScope;
      return (scopeRank[candidate] || 1) > (scopeRank[current] || 1) ? candidate : current;
    }, 'assigned_only');
    return { scope, user };
  }

  async whereForUser(userOrId) {
    const userId = typeof userOrId === 'object' ? userOrId.id : userOrId;
    const [{ scope, user }, accountWhere] = await Promise.all([
      this.getUserScope(userId),
      whatsappAccountAccessService.whereForUser(userId)
    ]);
    if (scope === 'all' || (typeof userOrId === 'object' && (userOrId.isSystemAdmin || userOrId.permissions?.includes('conversation.view_assigned_others')))) return accountWhere;
    const roleIds = (user.roles || []).map((role) => role.id).filter(Boolean);
    let conversationWhere;
    if (scope === 'role_only') {
      conversationWhere = roleIds.length ? { assignedRoleId: { [Op.in]: roleIds } } : { id: null };
    } else {
      conversationWhere = {
        [Op.or]: [
          { assignedUserId: user.id },
          { assignedUserId: null },
          ...(roleIds.length ? [{ assignedRoleId: { [Op.in]: roleIds } }] : [])
        ]
      };
    }
    return Object.keys(accountWhere).length
      ? { [Op.and]: [accountWhere, conversationWhere] }
      : conversationWhere;
  }

  async scopedWhere(userOrId, baseWhere = {}) {
    const scopeWhere = await this.whereForUser(userOrId);
    return Object.keys(scopeWhere).length
      ? { [Op.and]: [baseWhere, scopeWhere] }
      : baseWhere;
  }

  async assertConversationAccess(conversationId, userOrId) {
    const where = await this.scopedWhere(userOrId, { id: conversationId });
    const accessible = await Conversation.findOne({ where, attributes: ['id'] });
    if (accessible) return accessible;

    const exists = await Conversation.findByPk(conversationId, { attributes: ['id'] });
    if (!exists) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    throw Object.assign(new Error('You do not have access to this conversation'), { status: 403 });
  }
}

module.exports = new ConversationAccessService();

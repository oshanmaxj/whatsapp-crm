const { Op } = require('sequelize');
const { Role, User, WhatsAppAccount } = require('../models');

class WhatsAppAccountAccessService {
  async userContext(userId) {
    const user = await User.findByPk(userId, {
      attributes: ['id', 'isSystemAdmin'],
      include: [{
        model: Role,
        as: 'roles',
        attributes: ['id', 'name'],
        through: { attributes: [] },
        required: false,
        include: [{
          model: WhatsAppAccount,
          as: 'whatsappAccounts',
          attributes: ['id'],
          through: { attributes: [] },
          required: false
        }]
      }]
    });
    if (!user) throw Object.assign(new Error('User not found'), { status: 401 });
    const isAdmin = user.isSystemAdmin
      || (user.roles || []).some((role) => String(role.name).toLowerCase() === 'admin');
    const accountIds = [...new Set((user.roles || [])
      .flatMap((role) => role.whatsappAccounts || [])
      .map((account) => String(account.id)))];
    return { user, isAdmin, accountIds };
  }

  async accessibleIds(userId) {
    const context = await this.userContext(userId);
    return context.isAdmin ? null : context.accountIds;
  }

  async whereForUser(userId, field = 'whatsappAccountId') {
    const ids = await this.accessibleIds(userId);
    return ids === null ? {} : { [field]: ids.length ? { [Op.in]: ids } : { [Op.in]: [] } };
  }

  async assertAccess(accountId, userId) {
    if (!accountId) throw Object.assign(new Error('Select a WhatsApp account'), { status: 422 });
    const ids = await this.accessibleIds(userId);
    if (ids !== null && !ids.includes(String(accountId))) {
      throw Object.assign(new Error('You do not have access to this WhatsApp account'), { status: 403 });
    }
    return accountId;
  }

  async resolveSelection(requestedId, userId) {
    if (requestedId) {
      await this.assertAccess(requestedId, userId);
      return requestedId;
    }
    const ids = await this.accessibleIds(userId);
    if (ids === null) return null;
    if (ids.length === 1) return ids[0];
    if (!ids.length) throw Object.assign(new Error('Your department has no WhatsApp account assigned'), { status: 403 });
    throw Object.assign(new Error('Select a WhatsApp account'), { status: 422 });
  }

  async assertDepartmentAccess(departmentId, userId) {
    if (!departmentId) return null;
    const context = await this.userContext(userId);
    if (!context.isAdmin && !(context.user.roles || []).some((role) => String(role.id) === String(departmentId))) {
      throw Object.assign(new Error('You cannot restrict a flow to another department'), { status: 403 });
    }
    return departmentId;
  }
}

module.exports = new WhatsAppAccountAccessService();

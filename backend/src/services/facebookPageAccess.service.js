const { Op } = require('sequelize');
const { Role, User, FacebookPage } = require('../models');

class FacebookPageAccessService {
  async userContext(userId) {
    const user = await User.findByPk(userId, {
      attributes: ['id', 'isSystemAdmin', 'allFacebookPages'],
      include: [{
        model: FacebookPage,
        as: 'facebookPages',
        attributes: ['id'],
        through: { attributes: [] },
        required: false
      }, {
        model: Role,
        as: 'roles',
        attributes: ['id', 'name'],
        through: { attributes: [] },
        required: false
      }]
    });
    if (!user) throw Object.assign(new Error('User not found'), { status: 401 });
    const isAdmin = user.isSystemAdmin
      || (user.roles || []).some((role) => String(role.name).toLowerCase() === 'admin');
    const userPageIds = [...new Set((user.facebookPages || []).map(page => String(page.id)))];
    const unrestricted = isAdmin || user.allFacebookPages !== false;
    return { user, isAdmin, unrestricted, pageIds: unrestricted ? [] : userPageIds };
  }

  async accessibleIds(userId) {
    const context = await this.userContext(userId);
    return context.unrestricted ? null : context.pageIds;
  }

  async whereForUser(userId, field = 'facebookPageId') {
    const ids = await this.accessibleIds(userId);
    return ids === null ? {} : { [field]: ids.length ? { [Op.in]: ids } : { [Op.in]: [] } };
  }

  async assertAccess(pageId, userId) {
    if (!pageId) throw Object.assign(new Error('Select a Facebook Page'), { status: 422 });
    const ids = await this.accessibleIds(userId);
    if (ids !== null && !ids.includes(String(pageId))) {
      throw Object.assign(new Error('You do not have access to this Facebook Page'), { status: 403 });
    }
    return pageId;
  }

  async resolveSelection(requestedId, userId) {
    if (requestedId) {
      await this.assertAccess(requestedId, userId);
      return requestedId;
    }
    const ids = await this.accessibleIds(userId);
    if (ids === null) return null;
    if (ids.length === 1) return ids[0];
    if (!ids.length) throw Object.assign(new Error('You have no Facebook Page assigned'), { status: 403 });
    throw Object.assign(new Error('Select a Facebook Page'), { status: 422 });
  }
}

module.exports = new FacebookPageAccessService();

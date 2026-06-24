const { User, Role, Permission } = require('../models');

class UserService {
  async getUsers(query = {}) {
    return User.findAll({
      where: query,
      include: [{ model: Role, as: 'roles' }],
      order: [['created_at', 'DESC']]
    });
  }

  async getUserById(id) {
    return User.findByPk(id, {
      include: [{ model: Role, as: 'roles' }]
    });
  }

  async updateUser(id, payload) {
    const user = await User.findByPk(id);
    if (!user) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }

    await user.update(payload);
    return this.getUserById(id);
  }

  async deleteUser(id) {
    const user = await User.findByPk(id);
    if (!user) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }

    await user.destroy();
    return { id };
  }

  async assignRoles(userId, roleIds = []) {
    const user = await User.findByPk(userId);
    if (!user) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }

    const roles = await Role.findAll({ where: { id: roleIds } });
    await user.setRoles(roles);
    return this.getUserById(userId);
  }

  async getRoles() {
    return Role.findAll({ include: [{ model: Permission, as: 'permissions' }] });
  }

  async getPermissions() {
    return Permission.findAll();
  }
}

module.exports = new UserService();

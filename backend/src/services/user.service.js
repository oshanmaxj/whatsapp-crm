const { User, Role, Permission } = require('../models');

const ROLE_NAMES = ['Admin', 'Manager', 'Agent', 'Marketing', 'Accountant', 'Lecturer'];
const PERMISSION_GROUPS = [
  'Dashboard',
  'Contacts',
  'Leads',
  'Agents',
  'Inbox',
  'Campaigns',
  'Workflows',
  'Appointments',
  'Courses',
  'Batches',
  'Students',
  'Fees',
  'Attendance',
  'Certificates',
  'Reports',
  'Settings',
  'Connect WhatsApp',
  'User Manager'
];
const PERMISSION_ACTIONS = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Send'];

function permissionCode(group, action) {
  return `${group.toLowerCase().replace(/\s+/g, '-')}.${action.toLowerCase()}`;
}

function serializeUser(user) {
  if (!user) return null;
  const plain = typeof user.toJSON === 'function' ? user.toJSON() : user;
  delete plain.passwordHash;
  return plain;
}

class UserService {
  async ensureAccessDefaults() {
    const roles = {};
    for (const name of ROLE_NAMES) {
      const [role] = await Role.findOrCreate({
        where: { name: name.toLowerCase() },
        defaults: { description: `${name} role` }
      });
      roles[name] = role;
    }

    const permissions = [];
    for (const group of PERMISSION_GROUPS) {
      for (const action of PERMISSION_ACTIONS) {
        const code = permissionCode(group, action);
        const [permission] = await Permission.findOrCreate({
          where: { code },
          defaults: { name: `${group} ${action}`, description: `${action} access for ${group}` }
        });
        permissions.push(permission);
      }
    }

    await roles.Admin.setPermissions(permissions);

    return { roles, permissions };
  }

  async getUsers(query = {}) {
    await this.ensureAccessDefaults();
    const users = await User.findAll({
      where: query,
      include: [{ model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] }],
      order: [['createdAt', 'DESC']]
    });
    return users.map(serializeUser);
  }

  async getUserById(id) {
    await this.ensureAccessDefaults();
    const user = await User.findByPk(id, {
      include: [{ model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] }]
    });
    return serializeUser(user);
  }

  async createUser(payload) {
    await this.ensureAccessDefaults();
    const existing = await User.findOne({ where: { email: payload.email } });
    if (existing) {
      const error = new Error('Email already registered');
      error.status = 409;
      throw error;
    }

    const [firstName, ...rest] = String(payload.name || '').trim().split(/\s+/).filter(Boolean);
    const user = await User.create({
      firstName: payload.firstName || firstName || null,
      lastName: payload.lastName || rest.join(' ') || null,
      email: payload.email,
      phone: payload.phone || null,
      passwordHash: payload.password,
      status: payload.status || 'active',
      isSystemAdmin: String(payload.role).toLowerCase() === 'admin'
    });

    if (payload.role) {
      await this.assignRoles(user.id, [payload.role]);
    }

    return this.getUserById(user.id);
  }

  async updateUser(id, payload) {
    const user = await User.findByPk(id);
    if (!user) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }

    const updates = { ...payload };
    delete updates.role;
    delete updates.roles;
    delete updates.password;
    if (payload.name && !payload.firstName && !payload.lastName) {
      const [firstName, ...rest] = String(payload.name).trim().split(/\s+/).filter(Boolean);
      updates.firstName = firstName || null;
      updates.lastName = rest.join(' ') || null;
    }

    if (updates.email && updates.email !== user.email) {
      const existing = await User.findOne({ where: { email: updates.email } });
      if (existing && String(existing.id) !== String(user.id)) {
        const error = new Error('Email already registered');
        error.status = 409;
        throw error;
      }
    }

    await user.update(updates);
    if (payload.role) {
      await this.assignRoles(id, [payload.role]);
    } else if (payload.roles) {
      await this.assignRoles(id, payload.roles);
    }
    return this.getUserById(id);
  }

  async deleteUser(id) {
    const user = await User.findByPk(id);
    if (!user) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }

    await user.update({ status: 'inactive' });
    return { id, status: 'inactive' };
  }

  async resetPassword(id, password) {
    const user = await User.findByPk(id);
    if (!user) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }
    user.passwordHash = password;
    await user.save();
    return { id, reset: true };
  }

  async assignRoles(userId, roles = []) {
    await this.ensureAccessDefaults();
    const user = await User.findByPk(userId);
    if (!user) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }

    const normalized = roles.map((role) => String(role).trim().toLowerCase()).filter(Boolean);
    const allRoles = await Role.findAll();
    const selectedRoles = allRoles.filter((role) => normalized.includes(String(role.id)) || normalized.includes(String(role.name).toLowerCase()));
    await user.setRoles(selectedRoles);
    return this.getUserById(userId);
  }

  async getRoles() {
    await this.ensureAccessDefaults();
    return Role.findAll({
      include: [{ model: Permission, as: 'permissions' }],
      order: [['name', 'ASC']]
    });
  }

  async createRole(payload) {
    await this.ensureAccessDefaults();
    const [role] = await Role.findOrCreate({
      where: { name: String(payload.name).trim().toLowerCase() },
      defaults: { description: payload.description || null }
    });
    if (payload.description !== undefined) await role.update({ description: payload.description });
    return role.reload({ include: [{ model: Permission, as: 'permissions' }] });
  }

  async updateRole(id, payload) {
    const role = await Role.findByPk(id);
    if (!role) {
      const error = new Error('Role not found');
      error.status = 404;
      throw error;
    }
    await role.update({
      name: payload.name ? String(payload.name).trim().toLowerCase() : role.name,
      description: payload.description !== undefined ? payload.description : role.description
    });
    return role.reload({ include: [{ model: Permission, as: 'permissions' }] });
  }

  async getPermissions() {
    await this.ensureAccessDefaults();
    return Permission.findAll({ order: [['name', 'ASC']] });
  }

  async setRolePermissions(roleId, permissionIds = []) {
    await this.ensureAccessDefaults();
    const role = await Role.findByPk(roleId);
    if (!role) {
      const error = new Error('Role not found');
      error.status = 404;
      throw error;
    }
    const requested = permissionIds.map((permission) => String(permission));
    const allPermissions = await Permission.findAll();
    const permissions = allPermissions.filter((permission) => requested.includes(String(permission.id)) || requested.includes(permission.code));
    await role.setPermissions(permissions);
    return role.reload({ include: [{ model: Permission, as: 'permissions' }] });
  }

  async getUserAccessPayload(id) {
    await this.ensureAccessDefaults();
    const user = await User.findByPk(id, {
      include: [{ model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] }]
    });
    if (!user) return null;
    const roles = user.roles || [];
    const permissions = Array.from(new Set(roles.flatMap((role) => (role.permissions || []).map((permission) => permission.code))));
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      isSystemAdmin: user.isSystemAdmin,
      roles: roles.map((role) => role.name),
      permissions
    };
  }
}

module.exports = new UserService();

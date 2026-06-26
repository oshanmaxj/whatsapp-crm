const { Permission, Role, RolePermission, sequelize, User, UserPermissionOverride, UserRole } = require('../models');
const logger = require('../config/logger');

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
  'Flow Builder',
  'User Manager'
];
const PERMISSION_ACTIONS = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Send'];
const EXTRA_PERMISSION_ACTIONS = {
  'Flow Builder': ['Publish', 'Test']
};

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
  async repairAccessDuplicates() {
    await this.repairDuplicateRows({
      model: Role,
      keyField: 'name',
      reassign: async (keepId, duplicateId) => {
        await UserRole.update({ roleId: keepId }, { where: { roleId: duplicateId } }).catch(() => null);
        await RolePermission.update({ roleId: keepId }, { where: { roleId: duplicateId } }).catch(() => null);
      }
    });

    await this.repairDuplicateRows({
      model: Permission,
      keyField: 'code',
      reassign: async (keepId, duplicateId) => {
        await RolePermission.update({ permissionId: keepId }, { where: { permissionId: duplicateId } }).catch(() => null);
      }
    });

    await this.repairDuplicatePermissionNames();

    await this.repairDuplicateRolePermissions();
  }

  async repairDuplicateRows({ model, keyField, reassign }) {
    const rows = await model.findAll({ paranoid: false, order: [['id', 'ASC']] });
    const seen = new Map();
    for (const row of rows) {
      const key = String(row[keyField] || '').trim().toLowerCase();
      if (!key) continue;
      if (!seen.has(key)) {
        seen.set(key, row);
        continue;
      }

      const keep = seen.get(key);
      await reassign(keep.id, row.id);
      await row.destroy({ force: true }).catch((error) => {
        logger.warn('access_duplicate_cleanup_failed', { model: model.name, id: row.id, error });
      });
    }
  }

  async repairDuplicateRolePermissions() {
    const rows = await RolePermission.findAll({ raw: true }).catch((error) => {
      logger.warn('role_permission_duplicate_scan_failed', error);
      return [];
    });
    const counts = new Map();
    rows.forEach((row) => {
      const roleId = row.roleId || row.role_id;
      const permissionId = row.permissionId || row.permission_id;
      if (!roleId || !permissionId) return;
      const key = `${roleId}:${permissionId}`;
      counts.set(key, { roleId, permissionId, count: (counts.get(key)?.count || 0) + 1 });
    });

    for (const { roleId, permissionId, count } of counts.values()) {
      if (count < 2) continue;
      await RolePermission.destroy({ where: { roleId, permissionId }, force: true });
      await RolePermission.findOrCreate({
        where: { roleId, permissionId },
        defaults: { roleId, permissionId }
      });
    }
  }

  async repairDuplicatePermissionNames() {
    const rows = await Permission.findAll({ paranoid: false, order: [['id', 'ASC']] });
    const seen = new Set();
    for (const row of rows) {
      const key = String(row.name || '').trim().toLowerCase();
      if (!key) continue;
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      const nextName = `${row.name} (${row.code})`.slice(0, 150);
      await row.update({ name: nextName }).catch((error) => {
        logger.warn('permission_name_duplicate_repair_failed', { id: row.id, name: row.name, error });
      });
      seen.add(String(nextName).toLowerCase());
    }
  }

  async ensureAccessDefaults() {
    await this.repairAccessDuplicates().catch((error) => {
      logger.warn('access_duplicate_repair_failed', error);
    });

    const roles = {};
    for (const name of ROLE_NAMES) {
      const normalizedName = name.toLowerCase();
      let role = await Role.findOne({
        where: sequelize.where(sequelize.fn('lower', sequelize.col('name')), normalizedName),
        paranoid: false
      });
      if (role?.deletedAt) {
        await role.restore();
      }
      if (role) {
        const updates = {};
        if (role.name !== normalizedName) updates.name = normalizedName;
        if (!role.description) updates.description = `${name} role`;
        if (Object.keys(updates).length) await role.update(updates);
      } else {
        [role] = await Role.findOrCreate({
          where: { name: normalizedName },
          defaults: { description: `${name} role` }
        });
      }
      roles[name] = role;
    }

    const permissions = [];
    for (const group of PERMISSION_GROUPS) {
      for (const action of [...PERMISSION_ACTIONS, ...(EXTRA_PERMISSION_ACTIONS[group] || [])]) {
        const code = permissionCode(group, action);
        const permissionName = `${group} ${action}`;
        let permission = await Permission.findOne({ where: { code }, paranoid: false });
        if (permission?.deletedAt) {
          await permission.restore();
        }
        if (permission) {
          const updates = {};
          if (!permission.name) updates.name = permissionName;
          if (!permission.description) updates.description = `${action} access for ${group}`;
          if (Object.keys(updates).length) await permission.update(updates);
        } else {
          [permission] = await Permission.findOrCreate({
            where: { code },
            defaults: { name: permissionName, description: `${action} access for ${group}` }
          });
        }
        permissions.push(permission);
      }
    }

    for (const permission of permissions) {
      await RolePermission.findOrCreate({
        where: { roleId: roles.Admin.id, permissionId: permission.id },
        defaults: { roleId: roles.Admin.id, permissionId: permission.id }
      }).catch((error) => {
        logger.warn('admin_permission_seed_skipped', {
          roleId: roles.Admin.id,
          permissionId: permission.id,
          error
        });
      });
    }

    return { roles, permissions };
  }

  async seedAccessDefaults() {
    return this.ensureAccessDefaults();
  }

  async safeEnsureAccessDefaults() {
    try {
      return await this.ensureAccessDefaults();
    } catch (error) {
      logger.warn('access_default_seed_failed', error);
      return { roles: {}, permissions: [] };
    }
  }

  async getUsers(query = {}) {
    const users = await User.findAll({
      where: query,
      include: [{ model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] }],
      order: [['createdAt', 'DESC']]
    });
    return users.map(serializeUser);
  }

  async getUserById(id) {
    const user = await User.findByPk(id, {
      include: [{ model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] }]
    });
    return serializeUser(user);
  }

  async createUser(payload) {
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
      department: payload.department || null,
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
    return Role.findAll({
      include: [{ model: Permission, as: 'permissions' }],
      order: [['name', 'ASC']]
    });
  }

  async createRole(payload) {
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
    return Permission.findAll({ order: [['name', 'ASC']] });
  }

  async setRolePermissions(roleId, permissionIds = []) {
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
    const user = await User.findByPk(id, {
      include: [
        { model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] },
        { model: UserPermissionOverride, as: 'permissionOverrides', include: [{ model: Permission, as: 'permission' }] }
      ]
    }).catch((error) => {
      logger.warn('user_access_payload_rbac_read_failed', { userId: id, error });
      return User.findByPk(id);
    });
    if (!user) return null;
    const roles = user.roles || [];
    const rolePermissions = new Set(roles.flatMap((role) => (role.permissions || []).map((permission) => permission.code)));
    const overrides = user.permissionOverrides || [];
    overrides.forEach((override) => {
      const code = override.permission?.code;
      if (!code) return;
      if (override.effect === 'deny') rolePermissions.delete(code);
      if (override.effect === 'allow') rolePermissions.add(code);
    });
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      department: user.department,
      status: user.status,
      isSystemAdmin: user.isSystemAdmin,
      roles: roles.map((role) => role.name),
      permissions: Array.from(rolePermissions)
    };
  }

  async getUserPermissions(id) {
    const user = await User.findByPk(id, {
      include: [
        { model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] },
        { model: UserPermissionOverride, as: 'permissionOverrides', include: [{ model: Permission, as: 'permission' }] }
      ]
    });
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    const allPermissions = await Permission.findAll({ order: [['name', 'ASC']] });
    const inherited = new Set((user.roles || []).flatMap((role) => (role.permissions || []).map((permission) => permission.code)));
    const overrideMap = new Map((user.permissionOverrides || []).map((override) => [override.permission?.code, override.effect]));
    const finalPermissions = new Set(inherited);
    overrideMap.forEach((effect, code) => {
      if (effect === 'deny') finalPermissions.delete(code);
      if (effect === 'allow') finalPermissions.add(code);
    });
    return {
      user: serializeUser(user),
      permissions: allPermissions.map((permission) => ({
        id: permission.id,
        code: permission.code,
        name: permission.name,
        inherited: inherited.has(permission.code),
        override: overrideMap.get(permission.code) || 'inherit',
        final: finalPermissions.has(permission.code)
      }))
    };
  }

  async setUserPermissions(id, overrides = []) {
    const user = await User.findByPk(id);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    if (!Array.isArray(overrides)) {
      throw Object.assign(new Error('Permission overrides must be an array'), { status: 400 });
    }

    for (const item of overrides) {
      if (!['inherit', 'allow', 'deny'].includes(item.effect)) {
        throw Object.assign(new Error('Permission override effect must be inherit, allow, or deny'), { status: 400 });
      }

      const permission = item.permissionId
        ? await Permission.findByPk(item.permissionId)
        : await Permission.findOne({ where: { code: item.code } });

      if (!permission) {
        throw Object.assign(new Error('Permission not found'), { status: 400 });
      }

      const where = { userId: id, permissionId: permission.id };
      if (item.effect === 'inherit') {
        await UserPermissionOverride.destroy({ where });
        continue;
      }

      const [override, created] = await UserPermissionOverride.findOrCreate({
        where,
        defaults: { ...where, effect: item.effect }
      });
      if (!created && override.effect !== item.effect) {
        await override.update({ effect: item.effect });
      }
    }
    return this.getUserPermissions(id);
  }
}

module.exports = new UserService();

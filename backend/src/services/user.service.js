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
        if (!role.chatVisibilityScope) {
          updates.chatVisibilityScope = ['Admin', 'Manager'].includes(name) ? 'all' : 'assigned_only';
        }
        if (Object.keys(updates).length) await role.update(updates);
      } else {
        [role] = await Role.findOrCreate({
          where: { name: normalizedName },
          defaults: {
            description: `${name} role`,
            chatVisibilityScope: ['Admin', 'Manager'].includes(name) ? 'all' : 'assigned_only'
          }
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

  async getUserById(id, transaction = null) {
    const user = await User.findByPk(id, {
      include: [{ model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] }],
      transaction
    });
    return serializeUser(user);
  }

  async resolveRole(roleReference, transaction = null) {
    if (roleReference === null || roleReference === undefined || roleReference === '') {
      throw Object.assign(new Error('Invalid role'), { status: 422 });
    }

    const numericRoleId = Number(roleReference);
    const role = Number.isInteger(numericRoleId) && numericRoleId > 0
      ? await Role.findByPk(numericRoleId, { transaction })
      : await Role.findOne({
          where: sequelize.where(
            sequelize.fn('lower', sequelize.col('name')),
            String(roleReference).trim().toLowerCase()
          ),
          transaction
        });

    if (!role || role.isActive === false) {
      throw Object.assign(new Error('Invalid role'), { status: 422 });
    }
    return role;
  }

  async createUser(payload) {
    const email = String(payload.email || '').trim().toLowerCase();
    const name = String(payload.name || '').trim();
    const [firstName, ...rest] = String(payload.name || '').trim().split(/\s+/).filter(Boolean);
    if (!name || !email || !payload.password) {
      throw Object.assign(new Error('Name, email, and password are required'), { status: 422 });
    }

    let createdUser;
    try {
      await sequelize.transaction(async (transaction) => {
        const existing = await User.findOne({ where: { email }, paranoid: false, transaction });
        if (existing) {
          throw Object.assign(new Error('Email already exists'), { status: 409 });
        }

        const role = await this.resolveRole(payload.roleId ?? payload.role, transaction);
        const user = await User.create({
          firstName: payload.firstName || firstName || null,
          lastName: payload.lastName || rest.join(' ') || null,
          email,
          phone: String(payload.phone || '').trim() || null,
          receiveAssignmentNotifications: payload.receiveAssignmentNotifications !== false,
          passwordHash: payload.password,
          status: payload.status || 'active',
          isSystemAdmin: String(role.name).toLowerCase() === 'admin'
        }, { transaction });

        await UserRole.create({
          userId: Number(user.id),
          roleId: Number(role.id)
        }, { transaction });
        createdUser = await this.getUserById(user.id, transaction);
        if (!createdUser) throw new Error('Unable to load created user');
      });
    } catch (error) {
      if (error.status) throw error;
      if (error.name === 'SequelizeUniqueConstraintError' || ['23505', 'ER_DUP_ENTRY'].includes(error.original?.code)) {
        throw Object.assign(new Error('Email already exists'), { status: 409 });
      }
      throw error;
    }

    return createdUser;
  }

  async updateUser(id, payload) {
    const userId = Number(id);
    try {
      await sequelize.transaction(async (transaction) => {
        const user = await User.findByPk(userId, { transaction });
        if (!user) {
          throw Object.assign(new Error('User not found'), { status: 404 });
        }

        const updates = { ...payload };
        delete updates.name;
        delete updates.roleId;
        delete updates.role;
        delete updates.roles;
        delete updates.password;
        if (payload.name && !payload.firstName && !payload.lastName) {
          const [firstName, ...rest] = String(payload.name).trim().split(/\s+/).filter(Boolean);
          updates.firstName = firstName || null;
          updates.lastName = rest.join(' ') || null;
        }

        if (updates.email) {
          updates.email = String(updates.email).trim().toLowerCase();
          if (updates.email !== user.email) {
            const existing = await User.findOne({ where: { email: updates.email }, paranoid: false, transaction });
            if (existing && String(existing.id) !== String(user.id)) {
              throw Object.assign(new Error('Email already exists'), { status: 409 });
            }
          }
        }

        await user.update(updates, { transaction });
        const roleReference = payload.roleId ?? payload.role;
        if (roleReference !== undefined && roleReference !== null && roleReference !== '') {
          const role = await this.resolveRole(roleReference, transaction);
          await UserRole.destroy({ where: { userId }, transaction });
          await UserRole.create({ userId, roleId: Number(role.id) }, { transaction });
          await user.update({ isSystemAdmin: String(role.name).toLowerCase() === 'admin' }, { transaction });
        }
      });
    } catch (error) {
      if (error.status) throw error;
      if (error.name === 'SequelizeUniqueConstraintError' || ['23505', 'ER_DUP_ENTRY'].includes(error.original?.code)) {
        throw Object.assign(new Error('Email already exists'), { status: 409 });
      }
      throw error;
    }
    return this.getUserById(userId);
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
    const normalizedUserId = Number(userId);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      throw Object.assign(new Error('Invalid user'), { status: 422 });
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      throw Object.assign(new Error('At least one valid role is required'), { status: 422 });
    }

    await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(normalizedUserId, { transaction });
      if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

      const selectedRoles = [];
      for (const roleReference of [...new Set(roles.map((role) => String(role).trim()))]) {
        selectedRoles.push(await this.resolveRole(roleReference, transaction));
      }
      const roleIds = [...new Set(selectedRoles.map((role) => Number(role.id)))];

      await UserRole.destroy({ where: { userId: normalizedUserId }, transaction });
      await UserRole.bulkCreate(
        roleIds.map((roleId) => ({ userId: normalizedUserId, roleId })),
        { transaction }
      );
      await user.update({
        isSystemAdmin: selectedRoles.some((role) => String(role.name).toLowerCase() === 'admin')
      }, { transaction });
    });
    return this.getUserById(normalizedUserId);
  }

  async getRoles({ includeInactive = false } = {}) {
    return Role.findAll({
      where: includeInactive ? {} : { isActive: true },
      include: [{ model: Permission, as: 'permissions' }],
      order: [['name', 'ASC']]
    });
  }

  async createRole(payload) {
    const chatVisibilityScope = ['all', 'assigned_only', 'role_only', 'role_and_assigned'].includes(payload.chatVisibilityScope)
      ? payload.chatVisibilityScope
      : 'assigned_only';
    const [role] = await Role.findOrCreate({
      where: { name: String(payload.name).trim().toLowerCase() },
      defaults: { description: payload.description || null, chatVisibilityScope }
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
    if (payload.chatVisibilityScope !== undefined && !['all', 'assigned_only', 'role_only', 'role_and_assigned'].includes(payload.chatVisibilityScope)) {
      throw Object.assign(new Error('Invalid chat visibility scope'), { status: 422 });
    }
    if (
      String(role.name).trim().toLowerCase() === 'admin'
      && payload.isActive === false
    ) {
      throw Object.assign(new Error('The ADMIN department cannot be deactivated because it protects administrator access'), { status: 409 });
    }
    await role.update({
      name: payload.name ? String(payload.name).trim().toLowerCase() : role.name,
      description: payload.description !== undefined ? payload.description : role.description,
      chatVisibilityScope: payload.chatVisibilityScope ?? role.chatVisibilityScope,
      receiveDepartmentAssignmentNotifications: payload.receiveDepartmentAssignmentNotifications
        ?? role.receiveDepartmentAssignmentNotifications,
      isActive: payload.isActive ?? role.isActive
    });
    return role.reload({ include: [{ model: Permission, as: 'permissions' }] });
  }

  async deactivateRole(id) {
    const role = await Role.findByPk(id);
    if (!role) throw Object.assign(new Error('Department not found'), { status: 404 });
    if (String(role.name).trim().toLowerCase() === 'admin') {
      throw Object.assign(new Error('The ADMIN department cannot be deactivated because it protects administrator access'), { status: 409 });
    }

    const userCount = await role.countUsers();
    await role.update({ isActive: false });
    return {
      ...role.toJSON(),
      userCount,
      warning: userCount > 0
        ? `${userCount} user(s) still belong to this department. It was deactivated and retained for history.`
        : 'Department deactivated and retained for history.'
    };
  }

  async getPermissions() {
    return Permission.findAll({ order: [['name', 'ASC']] });
  }

  async setRolePermissions(roleId, permissionIds = []) {
    const normalizedRoleId = Number(roleId);
    if (!Number.isInteger(normalizedRoleId) || normalizedRoleId <= 0) {
      throw Object.assign(new Error('Invalid role'), { status: 422 });
    }
    if (!Array.isArray(permissionIds)) {
      throw Object.assign(new Error('Invalid permission list'), { status: 422 });
    }

    const providedPermissionIds = permissionIds.filter((permissionId) => permissionId !== null && permissionId !== undefined);
    const numericPermissionIds = providedPermissionIds.map((permissionId) => Number(permissionId));
    if (numericPermissionIds.some((permissionId) => !Number.isInteger(permissionId) || permissionId <= 0)) {
      throw Object.assign(new Error('Invalid permission'), { status: 422 });
    }
    const cleanPermissionIds = [...new Set(numericPermissionIds)];

    const role = await Role.findByPk(normalizedRoleId);
    if (!role) {
      const error = new Error('Invalid role');
      error.status = 422;
      throw error;
    }

    if (cleanPermissionIds.length > 0) {
      const permissionCount = await Permission.count({ where: { id: cleanPermissionIds } });
      if (permissionCount !== cleanPermissionIds.length) {
        throw Object.assign(new Error('Invalid permission'), { status: 422 });
      }
    }

    await sequelize.transaction(async (transaction) => {
      await RolePermission.destroy({
        where: { roleId: normalizedRoleId },
        transaction
      });
      if (cleanPermissionIds.length > 0) {
        await RolePermission.bulkCreate(
          cleanPermissionIds.map((permissionId) => ({
            roleId: normalizedRoleId,
            permissionId: Number(permissionId)
          })),
          { transaction }
        );
      }
    });

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

const userService = require('../services/user.service');

class UserController {
  async list(req, res, next) {
    try {
      const users = await userService.getUsers();
      return res.status(200).json({ success: true, data: users });
    } catch (err) {
      next(err);
    }
  }

  async getById(req, res, next) {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(id);
      if (!user) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }
      return res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const user = await userService.createUser(req.body);
      return res.status(201).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const { id } = req.params;
      const payload = req.body;
      const user = await userService.updateUser(id, payload);
      return res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  async remove(req, res, next) {
    try {
      const { id } = req.params;
      const result = await userService.deleteUser(id);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const result = await userService.resetPassword(req.params.id, req.body.password);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async assignRoles(req, res, next) {
    try {
      const { id } = req.params;
      const { roles } = req.body;
      const user = await userService.assignRoles(id, roles);
      return res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  async getRoles(req, res, next) {
    try {
      const roles = await userService.getRoles();
      return res.status(200).json({ success: true, data: roles });
    } catch (err) {
      next(err);
    }
  }

  async getPermissions(req, res, next) {
    try {
      const permissions = await userService.getPermissions();
      return res.status(200).json({ success: true, data: permissions });
    } catch (err) {
      next(err);
    }
  }

  async createRole(req, res, next) {
    try {
      const role = await userService.createRole(req.body);
      return res.status(201).json({ success: true, data: role });
    } catch (err) {
      next(err);
    }
  }

  async updateRole(req, res, next) {
    try {
      const role = await userService.updateRole(req.params.id, req.body);
      return res.status(200).json({ success: true, data: role });
    } catch (err) {
      next(err);
    }
  }

  async setRolePermissions(req, res, next) {
    try {
      const requestedPermissions = req.body.permissionIds || req.body.permissions || [];
      const role = await userService.setRolePermissions(req.params.id, Array.isArray(requestedPermissions) ? requestedPermissions : [requestedPermissions]);
      return res.status(200).json({ success: true, data: role });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new UserController();

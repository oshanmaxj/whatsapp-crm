const express = require('express');
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/authorize.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', userController.getRoles.bind(userController));
router.post('/', authorize.adminOnly, userController.createRole.bind(userController));
router.patch('/:id', authorize.adminOnly, userController.updateRole.bind(userController));
router.patch('/:id/deactivate', authorize.adminOnly, userController.deactivateRole.bind(userController));
router.delete('/:id', authorize.adminOnly, userController.deactivateRole.bind(userController));
router.put('/:id/permissions', authorize.adminOnly, userController.setRolePermissions.bind(userController));

module.exports = router;

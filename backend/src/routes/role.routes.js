const express = require('express');
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/authorize.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);
router.use(authorize.adminOnly);

router.get('/', userController.getRoles.bind(userController));
router.post('/', userController.createRole.bind(userController));
router.patch('/:id', userController.updateRole.bind(userController));
router.put('/:id/permissions', userController.setRolePermissions.bind(userController));

module.exports = router;

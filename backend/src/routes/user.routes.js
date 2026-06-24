const express = require('express');
const userController = require('../controllers/user.controller');
const { validateBody } = require('../middleware/validate.middleware');
const { updateUserSchema, assignRolesSchema } = require('../validators/user.validator');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/authorize.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);
router.use(authorize.adminOnly);

router.get('/', userController.list.bind(userController));
router.get('/roles', userController.getRoles.bind(userController));
router.get('/permissions', userController.getPermissions.bind(userController));
router.get('/:id', userController.getById.bind(userController));
router.patch('/:id', validateBody(updateUserSchema), userController.update.bind(userController));
router.delete('/:id', userController.remove.bind(userController));
router.post('/:id/roles', validateBody(assignRolesSchema), userController.assignRoles.bind(userController));

module.exports = router;
const express = require('express');
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/authorize.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);
router.use(authorize.adminOnly);

router.get('/', userController.getPermissions.bind(userController));

module.exports = router;

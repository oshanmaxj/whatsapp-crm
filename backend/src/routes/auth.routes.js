const express = require('express');
const authController = require('../controllers/auth.controller');
const { validateBody } = require('../middleware/validate.middleware');
const { registerSchema, loginSchema, refreshSchema } = require('../validators/auth.validator');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/register', validateBody(registerSchema), authController.register.bind(authController));
router.post('/login', validateBody(loginSchema), authController.login.bind(authController));
router.post('/refresh', validateBody(refreshSchema), authController.refreshToken.bind(authController));
router.post('/password/forgot', authController.requestPasswordReset.bind(authController));
router.post('/password/reset', authController.resetPassword.bind(authController));
router.get('/me', authMiddleware.authenticate, authController.me.bind(authController));

module.exports = router;

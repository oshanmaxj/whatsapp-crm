const express = require('express');
const authController = require('../controllers/auth.controller');
const { validateBody } = require('../middleware/validate.middleware');
const {
  registerSchema,
  loginSchema,
  updateMeSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} = require('../validators/auth.validator');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/register', validateBody(registerSchema), authController.register.bind(authController));
router.post('/login', validateBody(loginSchema), authController.login.bind(authController));
router.post('/refresh', authController.refreshToken.bind(authController));
router.post('/logout', authController.logout.bind(authController));
router.post('/password/forgot', validateBody(forgotPasswordSchema), authController.requestPasswordReset.bind(authController));
router.post('/password/reset', validateBody(resetPasswordSchema), authController.resetPassword.bind(authController));
router.get('/me', authMiddleware.authenticate, authController.me.bind(authController));
router.patch('/me', authMiddleware.authenticate, validateBody(updateMeSchema), authController.updateMe.bind(authController));
router.post('/change-password', authMiddleware.authenticate, validateBody(changePasswordSchema), authController.changePassword.bind(authController));

module.exports = router;

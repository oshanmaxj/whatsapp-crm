const express = require('express');
const flowMediaPublicController = require('../controllers/flowMediaPublic.controller');

// Intentionally has NO authMiddleware.authenticate — Meta's servers fetch
// Messenger media attachments directly and cannot present CRM credentials.
// Safety instead comes entirely from the token itself (see
// facebookMediaUrlResolver.service.js): HMAC-signed, time-limited, and only
// ever minted server-side for a file this server legitimately stored as
// sendable Flow media.
const router = express.Router();

router.get('/:token', flowMediaPublicController.serve);
router.head('/:token', flowMediaPublicController.serve);

module.exports = router;

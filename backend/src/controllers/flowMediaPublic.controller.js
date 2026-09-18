const fs = require('fs');
const fsp = require('fs/promises');
const facebookMediaUrlResolver = require('../services/facebookMediaUrlResolver.service');
const interactiveMediaService = require('../services/interactiveMedia.service');
const logger = require('../config/logger');

// Deliberately narrow: this is the ONLY thing this route can ever do — serve
// the exact bytes of a file this same server wrote during a legitimate Flow
// media upload, identified by an HMAC-signed, time-limited token that only
// this server could have minted (see facebookMediaUrlResolver.service.js).
// No directory listing, no arbitrary path input, no CRM authentication
// (Meta's servers cannot present one), and never a raw filesystem path in
// any response or log line.
async function serve(req, res) {
  const verified = facebookMediaUrlResolver.verifyPublicMediaToken(req.params.token);
  if (!verified) {
    logger.warn('flow_media_public_request_rejected', { reason: 'invalid_or_expired_token' });
    return res.status(404).json({ success: false, message: 'Not found.' });
  }

  let filePath;
  try {
    filePath = interactiveMediaService.resolvePrivatePath(verified.relativePath);
  } catch {
    logger.warn('flow_media_public_request_rejected', { reason: 'invalid_reference' });
    return res.status(404).json({ success: false, message: 'Not found.' });
  }

  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    logger.warn('flow_media_public_request_rejected', { reason: 'file_missing' });
    return res.status(404).json({ success: false, message: 'Not found.' });
  }

  res.setHeader('Content-Type', verified.mimeType);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (req.method === 'HEAD') return res.end();

  return new Promise((resolve) => {
    fs.createReadStream(filePath)
      .on('error', () => { if (!res.headersSent) res.status(500); res.end(); resolve(); })
      .on('end', resolve)
      .pipe(res);
  });
}

module.exports = { serve };

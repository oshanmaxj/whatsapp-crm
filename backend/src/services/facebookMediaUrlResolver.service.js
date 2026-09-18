const crypto = require('crypto');
const fsp = require('fs/promises');
const interactiveMediaService = require('./interactiveMedia.service');
const facebookSettingsService = require('./facebookSettings.service');
const logger = require('../config/logger');

// Same-origin Flow media node config fields the WhatsApp send path
// (flow.service.js executeMessageNode) already reads — reused verbatim so a
// single upload continues to work identically for both channels.
const URL_FIELD_BY_MEDIA_TYPE = { image: 'imageUrl', document: 'fileUrl' };
const PUBLIC_PATH_PREFIX = '/api/public/flow-media';
// Long enough to comfortably cover Meta's initial fetch/re-host of the
// attachment (which happens synchronously when the Send API call is made)
// plus manual re-tries or delayed delivery, short enough that a leaked URL
// (e.g. via logs) does not stay fetchable indefinitely.
const TOKEN_TTL_MS = Number(process.env.FLOW_MEDIA_PUBLIC_URL_TTL_MS || 7 * 24 * 60 * 60 * 1000);

function mediaError(message, code, status = 422) {
  return Object.assign(new Error(message), { code, status, exposeMessage: true });
}

// Derived from the same secret material already used to encrypt stored app
// settings (facebookSettings.service.js) / sign auth tokens — domain-separated
// with a distinct label so it is cryptographically independent of those other
// uses. No new secret/env var is introduced for this.
function signingKey() {
  const source = process.env.APP_SETTINGS_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || '';
  return crypto.createHash('sha256').update(`${source}:flow-media-public-url`).digest();
}

function mintPublicMediaToken(relativePath, mimeType) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${relativePath}|${mimeType}|${expiresAt}`;
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', signingKey()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${mac}`;
}

// Only a token minted by mintPublicMediaToken() (i.e. only ever produced
// server-side, for a file this same server just wrote during a legitimate
// Flow media upload) can verify successfully — an admin cannot forge one by
// hand-editing a flow node's JSON config, since doing so cannot reproduce a
// valid HMAC without the server-side signing key.
function verifyPublicMediaToken(token) {
  const [payloadB64, mac] = String(token || '').split('.');
  if (!payloadB64 || !mac) return null;
  const expectedMac = crypto.createHmac('sha256', signingKey()).update(payloadB64).digest('base64url');
  const provided = Buffer.from(mac);
  const expected = Buffer.from(expectedMac);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  let payload;
  try { payload = Buffer.from(payloadB64, 'base64url').toString('utf8'); } catch { return null; }
  const parts = payload.split('|');
  if (parts.length !== 3) return null;
  const [relativePath, mimeType, expiresAtRaw] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!relativePath || !mimeType || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return { relativePath, mimeType };
}

function isMimeSupportedForType(mediaType, mimeType) {
  const rule = interactiveMediaService.MEDIA_RULES[mediaType];
  return Boolean(rule && mimeType && rule.mimeTypes.has(String(mimeType).toLowerCase()));
}

// The single decision point for "what URL does Messenger's Send API get for
// this media node" — used only by executeFacebookMessageNode. WhatsApp's own
// media resolution (executeMessageNode / interactiveMediaService) is
// untouched by this module.
async function resolveForMessenger({ mediaType, config = {}, flowId = null, flowRunId = null, nodeId = null }) {
  const urlField = URL_FIELD_BY_MEDIA_TYPE[mediaType] || 'mediaUrl';
  const configuredUrl = config[urlField] || config.mediaUrl;
  const logBase = { flowId, flowRunId, nodeId, mediaType };

  try {
    // Strategy 1: the node already has a real, admin-provided public HTTPS
    // URL (never a `data:` URL — that is only ever an unsent local preview).
    if (configuredUrl && !String(configuredUrl).startsWith('data:')) {
      let parsed;
      try { parsed = new URL(String(configuredUrl)); } catch { parsed = null; }
      const isLocalhost = parsed && (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.hostname.endsWith('.local'));
      if (!parsed || parsed.protocol !== 'https:' || isLocalhost) {
        throw mediaError(`Facebook Messenger ${mediaType} URL must be a public HTTPS URL.`, 'FACEBOOK_MEDIA_URL_INVALID');
      }
      logger.info('facebook_media_resolved', { ...logBase, strategy: 'existing_https' });
      return { url: parsed.toString(), strategy: 'existing_https' };
    }

    // Strategy 2: the node references media the Flow Builder already
    // uploaded to WhatsApp (and cached privately on this server) — mint a
    // short-lived, HMAC-signed public URL to that exact same private file so
    // Meta's servers can fetch it without any CRM authentication, without
    // exposing the underlying filesystem path or any unrelated file.
    const localMediaRef = config.mediaLocalRef || config.localMediaRef || null;
    if (localMediaRef) {
      const mimeType = String(config.mimeType || '').toLowerCase() || null;
      if (!isMimeSupportedForType(mediaType, mimeType)) {
        throw mediaError(`This ${mediaType}'s stored file type is not supported for Messenger delivery. Re-upload it.`, 'FACEBOOK_MEDIA_MIME_UNSUPPORTED');
      }
      // Reuses interactiveMediaService's own path-containment guard — the
      // exact same one WhatsApp media resolution relies on — instead of a
      // second, parallel traversal check.
      let filePath;
      try {
        filePath = interactiveMediaService.resolvePrivatePath(localMediaRef);
      } catch {
        throw mediaError('The stored media reference for this node is invalid.', 'FACEBOOK_MEDIA_REFERENCE_INVALID');
      }
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat?.isFile()) {
        throw mediaError('The uploaded media file for this node is missing on the server. Re-upload it in the Flow Builder.', 'FACEBOOK_MEDIA_FILE_MISSING');
      }
      const token = mintPublicMediaToken(localMediaRef, mimeType);
      const url = `${facebookSettingsService.publicBaseUrl()}${PUBLIC_PATH_PREFIX}/${token}`;
      logger.info('facebook_media_resolved', { ...logBase, strategy: 'crm_media_public_url' });
      return { url, strategy: 'crm_media_public_url' };
    }

    // The node has a WhatsApp media ID but no local cache of the file (e.g.
    // it predates this server, or the private cache was cleared) — there is
    // no way to convert a WhatsApp-only Meta media ID into something
    // Messenger's Send API can use, so this is a distinct, explained failure
    // rather than a generic "no URL" message.
    if (config.whatsappMediaId || config.mediaId) {
      throw mediaError('This media was uploaded directly to WhatsApp with no local copy on this server, so it cannot be sent to Facebook Messenger. Re-upload the file in the Flow Builder.', 'FACEBOOK_MEDIA_NOT_CONVERTIBLE');
    }

    throw mediaError('Facebook Messenger media nodes require a public HTTPS URL or an uploaded CRM media file.', 'FACEBOOK_MEDIA_URL_REQUIRED');
  } catch (error) {
    logger.warn('facebook_media_resolution_failed', { ...logBase, reason: error.code || 'UNKNOWN' });
    throw error;
  }
}

module.exports = {
  resolveForMessenger,
  mintPublicMediaToken,
  verifyPublicMediaToken,
  PUBLIC_PATH_PREFIX,
  TOKEN_TTL_MS
};

const crypto = require('crypto');
const axios = require('axios');
const dns = require('dns').promises;
const fsp = require('fs/promises');
const net = require('net');
const path = require('path');
const whatsappService = require('./whatsapp.service');
const logger = require('../config/logger');

const PRIVATE_ROOT = path.resolve(process.env.FLOW_MEDIA_PRIVATE_ROOT || path.join(__dirname, '../../private/flow-media'));
const MEDIA_RULES = Object.freeze({
  image: { maxBytes: 5 * 1024 * 1024, mimeTypes: new Set(['image/jpeg', 'image/png']) },
  video: { maxBytes: 16 * 1024 * 1024, mimeTypes: new Set(['video/mp4', 'video/3gpp']) },
  audio: {
    maxBytes: 16 * 1024 * 1024,
    mimeTypes: new Set(['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'])
  },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: new Set([
      'application/pdf', 'text/plain', 'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ])
  }
});

function mediaError(message, code, status = 422) {
  return Object.assign(new Error(message), {
    code, status, exposeMessage: true, uploadError: true, rejectedLayer: 'app'
  });
}

function safeFilename(value, fallback = 'media') {
  const normalized = path.basename(String(value || fallback)).normalize('NFC');
  const safe = normalized.replace(/[^a-zA-Z0-9._() -]/g, '_').replace(/\s+/g, ' ').trim();
  return (safe || fallback).slice(0, 240);
}

function inferMediaType(mimeType) {
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return Object.entries(MEDIA_RULES).find(([, rule]) => rule.mimeTypes.has(mime))?.[0] || null;
}

function validateMedia({ mediaType, mimeType, size, fileName }) {
  const type = String(mediaType || inferMediaType(mimeType) || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const bytes = Number(size || 0);
  const rule = MEDIA_RULES[type];
  if (!rule) throw mediaError('WhatsApp media supports image, video, audio, or document files.', 'INTERACTIVE_MEDIA_TYPE_UNSUPPORTED');
  if (!rule.mimeTypes.has(mime)) throw mediaError(`Unsupported ${type} type: ${mime || 'unknown'}.`, 'INTERACTIVE_MEDIA_MIME_UNSUPPORTED');
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw mediaError('The selected media file is empty.', 'INTERACTIVE_MEDIA_EMPTY');
  if (bytes > rule.maxBytes) {
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    throw mediaError(`${label} exceeds the ${Math.floor(rule.maxBytes / 1024 / 1024)} MB WhatsApp limit.`, 'FILE_TOO_LARGE', 413);
  }
  return { mediaType: type, mimeType: mime, size: bytes, fileName: safeFilename(fileName, type) };
}

function decodeBase64(value) {
  const raw = String(value || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!raw || !/^[a-zA-Z0-9+/]*={0,2}$/.test(raw)) throw mediaError('The selected media file is invalid.', 'INTERACTIVE_MEDIA_INVALID');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw mediaError('The selected media file is empty.', 'INTERACTIVE_MEDIA_EMPTY');
  return buffer;
}

function validateFileContent(buffer, valid) {
  const prefix = buffer.subarray(0, 12);
  const ascii = buffer.toString('latin1');
  if (valid.mimeType === 'image/jpeg' && !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)) throw mediaError('Selected file is not a valid JPEG image.', 'INTERACTIVE_MEDIA_CONTENT_INVALID');
  if (valid.mimeType === 'image/png' && !prefix.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...prefix.subarray(8)]))) throw mediaError('Selected file is not a valid PNG image.', 'INTERACTIVE_MEDIA_CONTENT_INVALID');
  if (valid.mediaType === 'video') {
    if (!ascii.includes('ftyp') || !ascii.includes('avc1')) throw mediaError('WhatsApp video headers require an H.264 MP4/3GPP file.', 'INTERACTIVE_VIDEO_CODEC_UNSUPPORTED');
    if (!ascii.includes('mp4a')) throw mediaError('WhatsApp video headers require AAC audio.', 'INTERACTIVE_VIDEO_AUDIO_UNSUPPORTED');
  }
  if (valid.mimeType === 'audio/ogg' && !ascii.includes('OpusHead')) {
    throw mediaError('WhatsApp OGG audio must use the Opus codec.', 'INTERACTIVE_MEDIA_CONTENT_INVALID');
  }
  if (valid.mimeType === 'application/pdf' && !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw mediaError('Selected file is not a valid PDF document.', 'INTERACTIVE_MEDIA_CONTENT_INVALID');
  return valid;
}

function isPrivateIp(address) {
  if (!net.isIP(address)) return true;
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return false;
}

async function publicHttpsUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (_) { throw mediaError('Interactive media URL must be a public HTTPS URL.', 'INTERACTIVE_MEDIA_URL_INVALID'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || ['localhost', 'localhost.localdomain'].includes(parsed.hostname.toLowerCase())) {
    throw mediaError('Interactive media URL must be a public HTTPS URL.', 'INTERACTIVE_MEDIA_URL_INVALID');
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw mediaError('Interactive media URL cannot resolve to a private or internal address.', 'INTERACTIVE_MEDIA_URL_PRIVATE');
  return parsed.toString();
}

async function validatePublicMediaUrl(value, mediaType) {
  const url = await publicHttpsUrl(value);
  let response;
  try {
    response = await axios.head(url, { timeout: 10000, maxRedirects: 0, validateStatus: (status) => status >= 200 && status < 300 });
  } catch (_) {
    throw mediaError('Meta must be able to access the interactive media URL without redirects.', 'INTERACTIVE_MEDIA_URL_UNAVAILABLE');
  }
  const mimeType = String(response.headers?.['content-type'] || '').toLowerCase().split(';')[0];
  const size = Number(response.headers?.['content-length'] || 0);
  if (!size) throw mediaError('Interactive media URL must provide a valid Content-Length.', 'INTERACTIVE_MEDIA_URL_SIZE_UNKNOWN');
  validateMedia({ mediaType, mimeType, size, fileName: path.basename(new URL(url).pathname) || mediaType });
  return url;
}

// Allow-list, not a deny-list: automatic re-upload from getMediaUrl() must
// only fire for a structured Meta error this repository already has
// evidence for as specifically meaning "this media reference is
// invalid/unavailable" — code 100 with error_subcode 2494010, the exact
// pairing flowMessageHistory.test.js and whatsappInteractiveMedia.test.js
// already use for a rejected/invalid media parameter. Everything else
// returns false and propagates unchanged: no error.response at all
// (network timeout, ECONNRESET, DNS/connectivity failure, or a local
// configuration error from getRuntimeConfig() that never reached Meta),
// 401/403, Meta auth code 190, rate-limit codes 4/17/80004, HTTP 429,
// HTTP >=500, any other 4xx, and — importantly — code 100 with ANY OTHER
// subcode, including subcode 33, which this exact codebase already uses
// elsewhere (whatsapp.service.js, whatsappAccount.service.js) to mean
// "phone number not accessible with this token" — an account/permission
// problem, not a media problem, and must not be treated as one here.
function isRefreshableMediaLookupError(error) {
  const meta = error?.response?.data?.error || {};
  return Number(meta.code) === 100 && Number(meta.error_subcode) === 2494010;
}

function resolvePrivatePath(localMediaRef) {
  const relative = path.normalize(String(localMediaRef || '')).replace(/^(\.\.(\\|\/|$))+/, '');
  const resolved = path.resolve(PRIVATE_ROOT, relative);
  if (!relative || (resolved !== PRIVATE_ROOT && !resolved.startsWith(`${PRIVATE_ROOT}${path.sep}`))) {
    throw mediaError('Stored interactive media reference is invalid.', 'INTERACTIVE_MEDIA_REFERENCE_INVALID');
  }
  return resolved;
}

class InteractiveMediaService {
  constructor(dependencies = {}) {
    this.whatsappService = dependencies.whatsappService || whatsappService;
    this.logger = dependencies.logger || logger;
  }

  // Content-addressed: the storage path is the SHA-256 of the validated
  // bytes, so re-uploading identical content always resolves to the same
  // physical file instead of writing another copy (previously every call
  // wrote a fresh crypto.randomUUID() file regardless of content). Existing
  // per-scope/UUID files from before this change are untouched and keep
  // resolving normally — this only changes where NEW uploads land.
  async storeAndUpload({ scope = 'flow', scopeId, buffer: suppliedBuffer, dataBase64, fileName, mimeType, mediaType, whatsappAccountId }) {
    if (!whatsappAccountId) throw mediaError('Select a WhatsApp account before uploading interactive media.', 'WHATSAPP_ACCOUNT_REQUIRED');
    const buffer = Buffer.isBuffer(suppliedBuffer) ? suppliedBuffer : decodeBase64(dataBase64);
    const valid = validateMedia({ mediaType, mimeType, size: buffer.length, fileName });
    validateFileContent(buffer, valid);
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    const relative = path.join('objects', digest.slice(0, 2), digest);
    const filePath = resolvePrivatePath(relative);

    const alreadyStored = async () => {
      const stat = await fsp.stat(filePath).catch(() => null);
      return Boolean(stat?.isFile() && stat.size === buffer.length);
    };
    if (!(await alreadyStored())) {
      // Write-then-rename rather than writing filePath directly: a second,
      // concurrent upload of the SAME bytes gets its own temp file (unique
      // crypto.randomUUID() name), so neither writer can observe the
      // other's partially-written content at the final path. If our
      // rename loses a race (name already present by the time we get
      // there — behavior differs by platform, so this isn't assumed to be
      // a specific error code), that's fine as long as the content that
      // ended up there is actually ours — verified by size below, never
      // just trusted.
      const tempPath = path.join(path.dirname(filePath), `.tmp-${crypto.randomUUID()}`);
      try {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(tempPath, buffer, { flag: 'wx' });
        await fsp.rename(tempPath, filePath);
      } catch (_) {
        await fsp.unlink(tempPath).catch(() => null);
        if (!(await alreadyStored())) {
          throw mediaError('Unable to store the media file. Try again or contact an administrator.', 'MEDIA_STORAGE_FAILED', 500);
        }
      }
    }
    const uploaded = await this.whatsappService.uploadMedia({
      filePath,
      mimeType: valid.mimeType,
      mediaType: valid.mediaType,
      fileSize: valid.size,
      whatsappAccountId
    });
    if (!uploaded?.id) throw mediaError('Media upload failed because Meta did not return a media ID.', 'META_MEDIA_ID_MISSING', 502);
    // Never unlink filePath on failure here: with content-addressed storage
    // it may already be the SAME object another binding (a different flow,
    // account, or node) legitimately references — unlike the old per-upload
    // UUID path, an unreferenced-but-correctly-stored object is harmless and
    // may simply be reused by a future upload of the same bytes.
    return {
      mediaId: String(uploaded.id),
      whatsappAccountId: String(whatsappAccountId),
      localMediaRef: relative.split(path.sep).join('/'),
      ...valid
    };
  }

  async uploadStored(binding, whatsappAccountId) {
    const valid = validateMedia(binding);
    const filePath = resolvePrivatePath(binding.localMediaRef);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size !== valid.size) throw mediaError('Stored interactive media is unavailable. Replace the file and try again.', 'INTERACTIVE_MEDIA_MISSING');
    const uploaded = await this.whatsappService.uploadMedia({ filePath, mimeType: valid.mimeType, mediaType: valid.mediaType, fileSize: valid.size, whatsappAccountId });
    if (!uploaded?.id) throw mediaError('Media upload failed because Meta did not return a media ID.', 'META_MEDIA_ID_MISSING', 502);
    return { ...binding, mediaId: String(uploaded.id), whatsappAccountId: String(whatsappAccountId), ...valid };
  }

  async resolveStored(binding, whatsappAccountId) {
    if (!whatsappAccountId) throw mediaError('A WhatsApp account is required for media.', 'WHATSAPP_ACCOUNT_REQUIRED');
    const normalized = {
      ...binding,
      mediaId: binding.mediaId || binding.whatsappMediaId || null,
      whatsappAccountId: binding.whatsappAccountId || binding.mediaAccountId || null,
      fileName: safeFilename(binding.fileName || binding.filename, binding.mediaType || 'media')
    };
    const sameAccount = Boolean(normalized.whatsappAccountId) && String(normalized.whatsappAccountId) === String(whatsappAccountId);
    // Same account AND a local copy to fall back on: don't blindly trust a
    // stored Meta media ID that may have expired (mirrors the verify-then-
    // refresh check resolveHeader() already does for interactive headers —
    // see the comment there). Any other combination below is unchanged from
    // before, including the no-local-copy case, which keeps its existing
    // explicit error/trust behavior exactly as-is.
    if (normalized.mediaId && sameAccount && normalized.localMediaRef) {
      try {
        const mediaInfo = await this.whatsappService.getMediaUrl(normalized.mediaId, await this.whatsappService.getRuntimeConfig(whatsappAccountId));
        const valid = validateMedia({
          ...normalized,
          mimeType: mediaInfo?.mime_type || normalized.mimeType,
          size: Number(mediaInfo?.file_size || normalized.size)
        });
        return { ...normalized, ...valid };
      } catch (error) {
        if (!isRefreshableMediaLookupError(error)) throw error;
        return this.uploadStored(normalized, whatsappAccountId);
      }
    }
    if (normalized.mediaId && (!normalized.localMediaRef || !normalized.whatsappAccountId || sameAccount)) {
      return normalized;
    }
    if (normalized.localMediaRef) return this.uploadStored(normalized, whatsappAccountId);
    if (normalized.mediaId) {
      throw mediaError('Media belongs to another WhatsApp account. Re-upload it for the selected account.', 'INTERACTIVE_MEDIA_ACCOUNT_MISMATCH');
    }
    throw mediaError('Stored media is unavailable. Replace the file and try again.', 'INTERACTIVE_MEDIA_MISSING');
  }

  async resolveHeader(header = null, { whatsappAccountId, interactiveType = 'button' } = {}) {
    if (!header || header.type === 'none') return { header: null, binding: null };
    const type = String(header.type || '').toLowerCase();
    if (type === 'text') {
      const text = String(header.text || '').trim();
      if (!text || text.length > 60) throw mediaError('Interactive text headers must contain 1 to 60 characters.', 'INTERACTIVE_HEADER_TEXT_INVALID');
      return { header: { type: 'text', text }, binding: null };
    }
    if (interactiveType !== 'button') throw mediaError('WhatsApp list messages support text headers only.', 'INTERACTIVE_HEADER_COMBINATION_UNSUPPORTED');
    if (!MEDIA_RULES[type]) throw mediaError('Interactive header format is invalid.', 'INTERACTIVE_HEADER_INVALID');
    if (!whatsappAccountId) throw mediaError('A WhatsApp account is required for interactive media.', 'WHATSAPP_ACCOUNT_REQUIRED');

    let binding = {
      mediaType: type,
      mediaId: header.mediaId || header.id || null,
      whatsappAccountId: header.whatsappAccountId || header.mediaAccountId || null,
      localMediaRef: header.localMediaRef || null,
      mimeType: header.mimeType || null,
      size: Number(header.size || 0),
      fileName: safeFilename(header.fileName || header.filename, type)
    };
    if (binding.mediaId && String(binding.whatsappAccountId) === String(whatsappAccountId)) {
      try {
        const mediaInfo = await this.whatsappService.getMediaUrl(binding.mediaId, await this.whatsappService.getRuntimeConfig(whatsappAccountId));
        const valid = validateMedia({
          ...binding,
          mimeType: mediaInfo?.mime_type || binding.mimeType,
          size: Number(mediaInfo?.file_size || binding.size)
        });
        binding = { ...binding, ...valid };
      } catch (_) {
        if (!binding.localMediaRef) throw mediaError('The Meta media ID is expired, unavailable, or belongs to another WhatsApp account.', 'INTERACTIVE_MEDIA_UNAVAILABLE');
        binding = await this.uploadStored(binding, whatsappAccountId);
      }
    } else if (binding.localMediaRef) {
      binding = await this.uploadStored(binding, whatsappAccountId);
    } else if (header.url || header.link) {
      const link = await validatePublicMediaUrl(header.url || header.link, type);
      return { header: { type, [type]: { link, ...(type === 'document' ? { filename: binding.fileName } : {}) } }, binding: { ...binding, url: link } };
    } else if (binding.mediaId) {
      throw mediaError('Media belongs to another WhatsApp account. Re-upload it for the selected account.', 'INTERACTIVE_MEDIA_ACCOUNT_MISMATCH');
    } else {
      throw mediaError('Interactive media is missing. Select a file and try again.', 'INTERACTIVE_MEDIA_MISSING');
    }
    return {
      header: { type, [type]: { id: binding.mediaId, ...(type === 'document' ? { filename: binding.fileName } : {}) } },
      binding
    };
  }
}

module.exports = new InteractiveMediaService();
module.exports.InteractiveMediaService = InteractiveMediaService;
module.exports.MEDIA_RULES = MEDIA_RULES;
module.exports.validateMedia = validateMedia;
module.exports.safeFilename = safeFilename;
module.exports.publicHttpsUrl = publicHttpsUrl;
module.exports.validatePublicMediaUrl = validatePublicMediaUrl;
module.exports.validateFileContent = validateFileContent;
module.exports.resolvePrivatePath = resolvePrivatePath;
module.exports.isRefreshableMediaLookupError = isRefreshableMediaLookupError;

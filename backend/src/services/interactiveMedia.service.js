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
  return Object.assign(new Error(message), { code, status, exposeMessage: true });
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
  if (!rule) throw mediaError('Interactive headers support image, video, or document media.', 'INTERACTIVE_MEDIA_TYPE_UNSUPPORTED');
  if (!rule.mimeTypes.has(mime)) throw mediaError(`Unsupported ${type} type: ${mime || 'unknown'}.`, 'INTERACTIVE_MEDIA_MIME_UNSUPPORTED');
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw mediaError('The selected media file is empty.', 'INTERACTIVE_MEDIA_EMPTY');
  if (bytes > rule.maxBytes) throw mediaError(`The selected ${type} exceeds the WhatsApp ${Math.floor(rule.maxBytes / 1024 / 1024)} MB limit.`, 'INTERACTIVE_MEDIA_TOO_LARGE');
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

  async storeAndUpload({ scope = 'flow', scopeId, dataBase64, fileName, mimeType, mediaType, whatsappAccountId }) {
    if (!whatsappAccountId) throw mediaError('Select a WhatsApp account before uploading interactive media.', 'WHATSAPP_ACCOUNT_REQUIRED');
    const buffer = decodeBase64(dataBase64);
    const valid = validateMedia({ mediaType, mimeType, size: buffer.length, fileName });
    validateFileContent(buffer, valid);
    const relative = path.join(safeFilename(scope, 'flow'), safeFilename(scopeId, 'unknown'), `${crypto.randomUUID()}-${valid.fileName}`);
    const filePath = resolvePrivatePath(relative);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, buffer, { flag: 'wx' });
    try {
      const uploaded = await this.whatsappService.uploadMedia({
        filePath,
        mimeType: valid.mimeType,
        mediaType: valid.mediaType,
        fileSize: valid.size,
        whatsappAccountId
      });
      if (!uploaded?.id) throw mediaError('Media upload failed because Meta did not return a media ID.', 'META_MEDIA_ID_MISSING', 502);
      return {
        mediaId: String(uploaded.id),
        whatsappAccountId: String(whatsappAccountId),
        localMediaRef: relative.split(path.sep).join('/'),
        ...valid
      };
    } catch (error) {
      await fsp.unlink(filePath).catch(() => null);
      throw error;
    }
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

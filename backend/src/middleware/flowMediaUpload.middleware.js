const multer = require('multer');
const logger = require('../config/logger');

const FLOW_MEDIA_TRANSPORT_LIMIT_BYTES = 20 * 1024 * 1024;

function uploadError(message, code, status, rejectedLayer) {
  return Object.assign(new Error(message), {
    code, status, rejectedLayer, uploadError: true, exposeMessage: true
  });
}

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: FLOW_MEDIA_TRANSPORT_LIMIT_BYTES,
    files: 1,
    fields: 8,
    fieldNameSize: 100,
    fieldSize: 1024
  },
  fileFilter(req, file, callback) {
    req.flowUploadMimeType = String(file.mimetype || 'application/octet-stream').toLowerCase();
    callback(null, true);
  }
}).single('file');

function messageForLimit(req) {
  if (req.flowUploadMimeType?.startsWith('video/')) return 'Video exceeds the 16 MB WhatsApp limit.';
  if (req.flowUploadMimeType?.startsWith('image/')) return 'Image exceeds the 5 MB WhatsApp limit.';
  return 'File exceeds the 20 MB CRM upload transport limit.';
}

function flowMediaUpload(req, res, next) {
  const contentLength = Number(req.headers['content-length'] || 0) || null;
  logger.info('flow_media_upload_received', {
    route: '/api/flows/:flowId/media',
    flowId: req.params.id,
    contentLength,
    contentType: String(req.headers['content-type'] || '').split(';')[0] || null,
    rejectedLayer: null
  });
  parser(req, res, (error) => {
    if (!error) {
      logger.info('flow_media_upload_parsed', {
        route: '/api/flows/:flowId/media', flowId: req.params.id,
        contentLength, mimeType: req.file?.mimetype || null,
        fileSize: req.file?.size || null, rejectedLayer: null
      });
      return next();
    }
    const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    const mapped = tooLarge
      ? uploadError(messageForLimit(req), 'FILE_TOO_LARGE', 413, 'multer')
      : uploadError('The media upload request is invalid.', error.code || 'UPLOAD_INVALID', 400, 'multer');
    logger.warn('flow_media_upload_rejected', {
      route: '/api/flows/:flowId/media', flowId: req.params.id,
      contentLength, mimeType: req.flowUploadMimeType || null,
      rejectedLayer: 'multer', errorCode: mapped.code
    });
    return next(mapped);
  });
}

function diagnostics(req, res) {
  return res.json({
    success: true,
    data: {
      route: '/api/flows/:flowId/media',
      transport: 'multipart/form-data',
      backendTransportLimitBytes: FLOW_MEDIA_TRANSPORT_LIMIT_BYTES,
      whatsappLimitsBytes: {
        image: 5 * 1024 * 1024,
        video: 16 * 1024 * 1024,
        document: 100 * 1024 * 1024
      },
      expectedProxyLimit: '25M',
      expectedBodyTimeout: '120s'
    }
  });
}

module.exports = { flowMediaUpload, diagnostics, FLOW_MEDIA_TRANSPORT_LIMIT_BYTES, uploadError };

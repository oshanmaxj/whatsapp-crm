const fs = require('fs/promises');
const path = require('path');

const uploadRoot = path.resolve(process.env.STORAGE_UPLOAD_DIR || path.join(__dirname, '../../uploads'));
const publicBaseUrl = (process.env.STORAGE_PUBLIC_URL || '').replace(/\/$/, '');

class StorageService {
  // `root` lets a caller write outside the public uploads/ tree entirely
  // (e.g. a private root never covered by app.js's express.static mount).
  // When writing to such a root, `makePublicUrl: false` skips computing a
  // /uploads/... URL that would be meaningless (nothing served that path).
  async uploadToSupabase({ path: storagePath, buffer, contentType, root = uploadRoot, makePublicUrl = true }) {
    if (!storagePath || !buffer) {
      const error = new Error('Storage path and buffer are required');
      error.status = 400;
      throw error;
    }

    const resolvedRoot = path.resolve(root);
    const normalizedPath = path.normalize(storagePath).replace(/^(\.\.(\\|\/|$))+/, '');
    const targetPath = path.resolve(resolvedRoot, normalizedPath);

    if (!targetPath.startsWith(resolvedRoot + path.sep) && targetPath !== resolvedRoot) {
      const error = new Error('Invalid storage path');
      error.status = 400;
      throw error;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(buffer));

    const relativePath = path.relative(resolvedRoot, targetPath).split(path.sep).join('/');
    return {
      path: relativePath,
      absolutePath: targetPath,
      contentType: contentType || 'application/octet-stream',
      url: !makePublicUrl ? null : publicBaseUrl ? `${publicBaseUrl}/${relativePath}` : `/uploads/${relativePath}`
    };
  }
}

module.exports = new StorageService();

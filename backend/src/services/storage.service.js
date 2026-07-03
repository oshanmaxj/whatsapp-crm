const fs = require('fs/promises');
const path = require('path');

const uploadRoot = path.resolve(process.env.STORAGE_UPLOAD_DIR || path.join(__dirname, '../../uploads'));
const publicBaseUrl = (process.env.STORAGE_PUBLIC_URL || '').replace(/\/$/, '');

class StorageService {
  async uploadToSupabase({ path: storagePath, buffer, contentType }) {
    if (!storagePath || !buffer) {
      const error = new Error('Storage path and buffer are required');
      error.status = 400;
      throw error;
    }

    const normalizedPath = path.normalize(storagePath).replace(/^(\.\.(\\|\/|$))+/, '');
    const targetPath = path.resolve(uploadRoot, normalizedPath);

    if (!targetPath.startsWith(uploadRoot + path.sep) && targetPath !== uploadRoot) {
      const error = new Error('Invalid storage path');
      error.status = 400;
      throw error;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(buffer));

    const relativePath = path.relative(uploadRoot, targetPath).split(path.sep).join('/');
    return {
      path: relativePath,
      absolutePath: targetPath,
      contentType: contentType || 'application/octet-stream',
      url: publicBaseUrl ? `${publicBaseUrl}/${relativePath}` : `/uploads/${relativePath}`
    };
  }
}

module.exports = new StorageService();

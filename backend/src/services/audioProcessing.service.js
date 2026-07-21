const { execFile } = require('child_process');
const fs = require('fs');

const META_AUDIO_MIMES = new Set(['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/opus']);

function convert(inputPath, outputPath) {
  return new Promise((resolve, reject) => execFile(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-y', '-i', inputPath, '-vn', '-c:a', 'libopus', '-b:a', '48k', outputPath
  ], { windowsHide: true, timeout: 60000 }, (error) => error ? reject(error) : resolve()));
}

class AudioProcessingService {
  async prepare({ filePath, mimeType }) {
    const normalized = String(mimeType || '').toLowerCase().split(';')[0];
    if (normalized === 'audio/m4a') return { filePath, mimeType: 'audio/mp4' };
    if (META_AUDIO_MIMES.has(normalized)) return { filePath, mimeType: normalized };
    if (normalized !== 'audio/webm') throw Object.assign(new Error(`Unsupported voice recording format: ${normalized || 'unknown'}.`), { status: 415, code: 'AUDIO_MIME_UNSUPPORTED' });
    const outputPath = filePath.replace(/\.[^.]+$/, '') + '.ogg';
    try {
      await convert(filePath, outputPath);
      await fs.promises.unlink(filePath).catch(() => null);
      return { filePath: outputPath, mimeType: 'audio/ogg', converted: true };
    } catch (error) {
      await fs.promises.unlink(outputPath).catch(() => null);
      throw Object.assign(new Error('This browser records WebM audio, but audio conversion is unavailable on the server. Install/configure FFmpeg or record from a browser that supports MP4 or OGG audio.'), { status: 415, code: 'AUDIO_CONVERSION_UNAVAILABLE' });
    }
  }
}

module.exports = new AudioProcessingService();

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const META_AUDIO_MIMES = new Set(['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/opus']);

function convert(inputPath, outputPath) {
  return new Promise((resolve, reject) => execFile(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-y', '-v', 'error', '-i', inputPath, '-map', '0:a:0', '-vn',
    '-c:a', 'libopus', '-b:a', '48k', '-application', 'voip', outputPath
  ], { windowsHide: true, timeout: 60000 }, (error) => error ? reject(error) : resolve()));
}

function detectAudioMime(bytes) {
  if (!bytes?.length) return null;
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'audio/mp4';
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (bytes.subarray(0, 6).toString('ascii') === '#!AMR\n') return 'audio/amr';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  return null;
}

function compatible(declared, detected) {
  const normalized = declared === 'audio/m4a' ? 'audio/mp4' : declared;
  return normalized === detected
    || (normalized === 'audio/opus' && detected === 'audio/ogg')
    || (normalized === 'application/ogg' && detected === 'audio/ogg');
}

class AudioProcessingService {
  async prepare({ filePath, mimeType }) {
    const declaredMimeType = String(mimeType || '').toLowerCase().split(';')[0];
    const handle = await fs.promises.open(filePath, 'r');
    const signature = Buffer.alloc(64);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    await handle.close();
    const detectedMimeType = detectAudioMime(signature.subarray(0, bytesRead));
    if (!detectedMimeType) {
      throw Object.assign(new Error('The voice recording is not a recognised audio container.'), { status: 415, code: 'AUDIO_BINARY_UNKNOWN' });
    }
    if (!compatible(declaredMimeType, detectedMimeType)) {
      throw Object.assign(new Error(`Voice recording content (${detectedMimeType}) does not match its declared type (${declaredMimeType || 'unknown'}).`), {
        status: 415, code: 'AUDIO_MIME_MISMATCH', detectedMimeType, declaredMimeType
      });
    }
    if (META_AUDIO_MIMES.has(detectedMimeType)) {
      return { filePath, mimeType: detectedMimeType, originalMimeType: declaredMimeType, detectedMimeType, converted: false };
    }
    if (!['audio/webm', 'audio/wav'].includes(detectedMimeType)) {
      throw Object.assign(new Error(`Unsupported voice recording format: ${detectedMimeType}.`), { status: 415, code: 'AUDIO_MIME_UNSUPPORTED' });
    }
    const outputPath = path.join(path.dirname(filePath), `${path.parse(filePath).name}.ogg`);
    try {
      await convert(filePath, outputPath);
      const output = await fs.promises.readFile(outputPath);
      if (detectAudioMime(output.subarray(0, 64)) !== 'audio/ogg' || output.length === 0) throw new Error('FFmpeg produced an invalid OGG file.');
      await fs.promises.unlink(filePath).catch(() => null);
      return { filePath: outputPath, mimeType: 'audio/ogg', originalMimeType: declaredMimeType, detectedMimeType, converted: true };
    } catch (error) {
      await fs.promises.unlink(outputPath).catch(() => null);
      throw Object.assign(new Error('Voice-message processing failed. FFmpeg with libopus is required for this browser recording format.'), {
        status: 415, code: 'AUDIO_CONVERSION_UNAVAILABLE'
      });
    }
  }
}

module.exports = new AudioProcessingService();
module.exports.AudioProcessingService = AudioProcessingService;
module.exports.detectAudioMime = detectAudioMime;

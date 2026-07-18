const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const privateRoot = path.resolve(process.env.RECEIPT_PRIVATE_ROOT || path.join(__dirname, '../../private/payment-receipts'));

function resolveKey(storageKey) {
  const raw = String(storageKey || '');
  if (raw.split(/[\\/]+/).includes('..')) {
    throw Object.assign(new Error('Invalid receipt storage key'), { status: 400, code: 'RECEIPT_STORAGE_KEY_INVALID' });
  }
  const normalized = path.normalize(raw);
  const target = path.resolve(privateRoot, normalized);
  if (!storageKey || (!target.startsWith(`${privateRoot}${path.sep}`) && target !== privateRoot)) {
    throw Object.assign(new Error('Invalid receipt storage key'), { status: 400, code: 'RECEIPT_STORAGE_KEY_INVALID' });
  }
  return target;
}

module.exports = {
  async store(buffer, year = new Date().getUTCFullYear()) {
    const storageKey = `${year}/${crypto.randomUUID()}.pdf`;
    const target = resolveKey(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(buffer), { flag: 'wx' });
    return storageKey;
  },
  resolveKey,
  async read(storageKey) { return fs.readFile(resolveKey(storageKey)); }
};

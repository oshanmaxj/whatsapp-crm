// Standard GSM 03.38 SMS segmentation rules. Provider-neutral — this has
// nothing to do with SMSGo specifically and estimates segment count the
// same way any SMS gateway would bill it.
//
// GSM-7: 160 chars for a single SMS, 153 per part once concatenated
// (the remaining 7 septets in each part are reserved for the UDH
// concatenation header). Characters in the GSM-7 "extended" table are
// escaped (2 septets each) and count double toward the length.
// UCS-2 (any character outside the GSM-7 repertoire, e.g. Sinhala/Tamil/
// emoji): 70 chars single SMS, 67 per part.
const GSM_7_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_7_EXTENDED = '^{}\\[~]|€';

function isGsm7(text) {
  const chars = [...String(text || '')];
  return chars.every((char) => GSM_7_BASIC.includes(char) || GSM_7_EXTENDED.includes(char));
}

function gsm7Length(text) {
  let length = 0;
  for (const char of String(text || '')) length += GSM_7_EXTENDED.includes(char) ? 2 : 1;
  return length;
}

function estimateSegments(text) {
  const value = String(text ?? '');
  if (!value) return { encoding: 'GSM-7', characters: 0, segments: 0, charsPerSegment: 160 };

  const gsm7 = isGsm7(value);
  const characters = gsm7 ? gsm7Length(value) : [...value].length;
  const singleLimit = gsm7 ? 160 : 70;
  const multiLimit = gsm7 ? 153 : 67;
  const segments = characters <= singleLimit ? 1 : Math.ceil(characters / multiLimit);

  return {
    encoding: gsm7 ? 'GSM-7' : 'UCS-2',
    characters,
    segments,
    charsPerSegment: segments === 1 ? singleLimit : multiLimit
  };
}

module.exports = { estimateSegments, isGsm7 };

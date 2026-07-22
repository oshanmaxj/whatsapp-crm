'use strict';

function parse(value, scale = 2) {
  const text = String(value ?? '0').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw Object.assign(new Error(`Invalid decimal: ${text}`), { status: 422 });
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const padded = `${fraction}${'0'.repeat(scale + 1)}`;
  let units = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(padded.slice(0, scale) || 0);
  if (Number(padded[scale] || 0) >= 5) units += 1n;
  return negative ? -units : units;
}

function format(units, scale = 2) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const divisor = 10n ** BigInt(scale);
  return `${negative ? '-' : ''}${absolute / divisor}.${String(absolute % divisor).padStart(scale, '0')}`;
}

function multiply(money, percentage) {
  const cents = parse(money, 2);
  const rate = parse(percentage, 4);
  const denominator = 100n * 10000n;
  const product = cents * rate;
  const rounded = product >= 0n ? (product + denominator / 2n) / denominator : -((-product + denominator / 2n) / denominator);
  return format(rounded, 2);
}

function add(...values) { return format(values.reduce((sum, value) => sum + parse(value), 0n)); }
function subtract(value, ...deductions) { return format(deductions.reduce((sum, item) => sum - parse(item), parse(value))); }
function min(value, cap) { return format(parse(value) < parse(cap) ? parse(value) : parse(cap)); }
function compare(left, right) { return parse(left) === parse(right) ? 0 : parse(left) > parse(right) ? 1 : -1; }
function prorate(amount, part, total) { const denominator=parse(total);if(denominator===0n)return'0.00';const product=parse(amount)*parse(part);const absolute=product<0n?-product:product;const rounded=(absolute+ (denominator<0n?-denominator:denominator)/2n)/(denominator<0n?-denominator:denominator);return format(product<0n?-rounded:rounded); }

module.exports = { parse, format, multiply, add, subtract, min, compare, prorate };

/**
 * Encode a string to base64
 * @param {string} str - Plain text string
 * @returns {string} Base64 encoded string
 */
export function encode(str) {
  if (!str) return str;
  return Buffer.from(str, 'utf-8').toString('base64');
}

/**
 * Decode a base64 string
 * @param {string} str - Base64 encoded string
 * @returns {string} Decoded plain text
 */
export function decode(str) {
  if (!str) return str;
  return Buffer.from(str, 'base64').toString('utf-8');
}

/**
 * Check if a string is valid base64
 * @param {string} str - String to check
 * @returns {boolean} True if valid base64
 */
export function isBase64(str) {
  if (!str || typeof str !== 'string') return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str) && str.length % 4 === 0;
}

/**
 * Decode if base64, otherwise return as-is
 * @param {string} str - String to decode
 * @param {boolean} base64Encoded - Whether the string is base64 encoded
 * @returns {string} Decoded or original string
 */
export function decodeIfNeeded(str, base64Encoded = false) {
  if (!str) return str;
  if (base64Encoded) {
    return decode(str);
  }
  return str;
}

/**
 * Encode if requested
 * @param {string} str - String to encode
 * @param {boolean} base64Encode - Whether to base64 encode
 * @returns {string} Encoded or original string
 */
export function encodeIfNeeded(str, base64Encode = false) {
  if (!str) return str;
  if (base64Encode) {
    return encode(str);
  }
  return str;
}

export default {
  encode,
  decode,
  isBase64,
  decodeIfNeeded,
  encodeIfNeeded,
};

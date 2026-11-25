'use strict';
const crypto = require('crypto');

const DEFAULT_PREFIX_LEN = 4;

// Uppercase hex, so keys and API replies are one canonical form.
function sha1Hex(input) {
  return crypto.createHash('sha1').update(input).digest('hex').toUpperCase();
}

function split(hash, prefixLen) {
  return { prefix: hash.slice(0, prefixLen), suffix: hash.slice(prefixLen) };
}

function isValidPrefix(prefix, prefixLen) {
  return typeof prefix === 'string' && prefix.length === prefixLen && /^[0-9A-Fa-f]+$/.test(prefix);
}

const listKey = (prefix) => `p:${prefix.toUpperCase()}`;
const META_KEY = 'prawns:meta';

module.exports = { DEFAULT_PREFIX_LEN, sha1Hex, split, isValidPrefix, listKey, META_KEY };

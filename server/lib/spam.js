'use strict';

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|xyz|info|biz|site|online)\b)/i;
const SPAM_WORDS = [
  'viagra',
  'casino',
  'bitcoin',
  'crypto',
  'forex',
  'loan',
  'buy followers',
  'cheap followers',
  'follow me',
  'dm me',
  'click here',
  'free prize',
  'cash prize',
  'giveaway',
  'lottery',
  'discount code',
  'weight loss',
  'free gift',
  'seo services'
];
const REPEAT_RE = /(.)\1{4,}/;

function detectSpam(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (URL_RE.test(t)) return 'Contains a link';
  const caps = (t.match(/[A-Z]/g) || []).length;
  if (t.length > 24 && caps / t.length > 0.6) return 'Mostly capital letters';
  if (REPEAT_RE.test(t)) return 'Repeated characters';
  const lower = t.toLowerCase();
  for (const word of SPAM_WORDS) {
    if (lower.includes(word)) return 'Suspicious wording';
  }
  if (opts.isDuplicate) return 'Same comment as an existing review';
  return null;
}

module.exports = { detectSpam };

'use strict';

const crypto = require('node:crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sbynham2026';
const TOKENS = new Set();

function createToken() {
  const token = crypto.randomBytes(24).toString('hex');
  TOKENS.add(token);
  return token;
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!TOKENS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { ADMIN_PASSWORD, createToken, requireAuth };

'use strict';

const crypto = require('node:crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const ROLES = ['manager', 'admin'];

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sbynham2026';
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || process.env.ADMIN_PASSWORD || 'sbynham2026';

function secret(role = 'admin') {
  return role === 'manager' ? MANAGER_PASSWORD : ADMIN_PASSWORD;
}

function sign(value, role) {
  return crypto.createHmac('sha256', secret(role)).update(value).digest('base64url');
}

function createToken(role = 'manager') {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, role)}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return null;
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (!ROLES.includes(decoded.role) || !secret(decoded.role)) return null;
  const expected = sign(payload, decoded.role);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  if (decoded.exp <= Date.now()) return null;
  return decoded.role;
}

function tokenFrom(req) {
  return String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
}

function requireAuth(req, res, next) {
  const role = verifyToken(tokenFrom(req));
  if (!role) return res.status(401).json({ error: 'Unauthorized' });
  req.role = role;
  next();
}

function requireAdmin(req, res, next) {
  const role = verifyToken(tokenFrom(req));
  if (!role) return res.status(401).json({ error: 'Unauthorized' });
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  req.role = role;
  next();
}

module.exports = { ADMIN_PASSWORD, MANAGER_PASSWORD, createToken, verifyToken, requireAuth, requireAdmin };

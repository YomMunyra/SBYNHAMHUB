'use strict';

const express = require('express');
const { db } = require('../../db');
const { ADMIN_PASSWORD, MANAGER_PASSWORD, createToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/auth', (req, res) => {
  const { password = '', role = 'manager' } = req.body || {};
  if (!['manager', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const expected = role === 'admin' ? ADMIN_PASSWORD : MANAGER_PASSWORD;
  if (password === expected) {
    return res.json({ ok: true, role, token: createToken(role) });
  }
  res.status(401).json({ error: 'Invalid password' });
});

router.post('/auth/impersonate', requireAdmin, (req, res) => {
  const { restaurant_id } = req.body || {};
  if (restaurant_id === undefined || restaurant_id === null || restaurant_id === '') {
    return res.status(400).json({ error: 'Restaurant id is required' });
  }
  const row = db.prepare('SELECT id, name FROM restaurants WHERE id = ?').get(Number(restaurant_id));
  if (!row) return res.status(404).json({ error: 'Restaurant not found' });
  res.json({ ok: true, role: 'manager', restaurant_id: Number(row.id), name: row.name, token: createToken('manager', Number(row.id)) });
});

module.exports = router;

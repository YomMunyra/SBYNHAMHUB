'use strict';

const express = require('express');
const { ADMIN_PASSWORD, MANAGER_PASSWORD, createToken } = require('../middleware/auth');

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

module.exports = router;

'use strict';

const express = require('express');
const { ADMIN_PASSWORD, createToken } = require('../middleware/auth');

const router = express.Router();

router.post('/auth', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true, token: createToken() });
  }
  res.status(401).json({ error: 'Invalid password' });
});

module.exports = router;

'use strict';

const express = require('express');
const { db } = require('../../db');
const { guestId } = require('../format');

const router = express.Router();

router.get('/points/lookup', (req, res) => {
  const { email = '', phone = '' } = req.query;
  const key = guestId(email, phone);
  const account = db.prepare('SELECT * FROM points_accounts WHERE guest_key = ?').get(key);
  if (!account) {
    return res.json({ balance: 0, lifetime: 0, history: [] });
  }
  const history = db
    .prepare('SELECT * FROM points_ledger WHERE guest_key = ? ORDER BY id DESC LIMIT 50')
    .all(key);
  res.json({ balance: account.balance, lifetime: account.lifetime, name: account.name, history });
});

module.exports = router;

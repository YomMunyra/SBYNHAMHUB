'use strict';

const express = require('express');
const { db } = require('../../db');
const { guestId } = require('../format');
const { computeBalance, expiringSoon, earliestExpiry, syncBalance, POINTS_EXPIRY_MONTHS } = require('../lib/points');

const router = express.Router();

router.get('/points/lookup', (req, res) => {
  const { email = '', phone = '' } = req.query;
  const key = guestId(email, phone);
  const account = db.prepare('SELECT * FROM points_accounts WHERE guest_key = ?').get(key);
  if (!account) {
    return res.json({ balance: 0, lifetime: 0, name: '', history: [], expiring_soon: 0, earliest_expiry: null });
  }
  const balance = computeBalance(db, key);
  syncBalance(db, key);
  const history = db
    .prepare('SELECT * FROM points_ledger WHERE guest_key = ? ORDER BY id DESC LIMIT 50')
    .all(key);
  res.json({
    balance,
    lifetime: account.lifetime,
    name: account.name,
    expiring_soon: expiringSoon(db, key),
    earliest_expiry: earliestExpiry(db, key),
    expiry_months: POINTS_EXPIRY_MONTHS,
    history
  });
});

module.exports = router;

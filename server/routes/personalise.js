'use strict';

const express = require('express');
const { db } = require('../../db');
const { guestId } = require('../format');
const { publicItem } = require('../format');
const {
  readiness,
  personalisedFeed,
  profile,
  recordSave,
  removeSave,
  recordCorrection,
  resetGuest,
  savesForGuest
} = require('../lib/personalize');

const router = express.Router();

function identity(req) {
  const email = String(req.query.email || req.body.email || '').trim();
  const phone = String(req.query.phone || req.body.phone || '').trim();
  if (!email && !phone) return null;
  return guestId(email, phone);
}

router.get('/personalise', (req, res) => {
  const key = identity(req);
  if (!key) return res.status(400).json({ error: 'Enter an email or phone.' });
  res.json({ guest_key: key, ...profile(db, key) });
});

router.get('/personalise/feed', (req, res) => {
  const key = identity(req);
  if (!key) return res.status(400).json({ error: 'Enter an email or phone.' });
  const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 6));
  const { state, top } = personalisedFeed(db, key, { limit });
  res.json({ ...state, items: top });
});

router.get('/saves', (req, res) => {
  const key = identity(req);
  if (!key) return res.status(400).json({ error: 'Enter an email or phone.' });
  const rows = savesForGuest(db, key);
  const items = db
    .prepare(
      `SELECT m.*, c.name AS category, c.slug AS category_slug
       FROM menu_items m JOIN categories c ON c.id = m.category_id
       WHERE m.id IN (${rows.length ? rows.map(() => '?').join(',') : '0'})`
    )
    .all(...rows.map((r) => r.item_id))
    .map(publicItem);
  res.json({ items });
});

router.post('/saves', (req, res) => {
  const key = identity(req);
  if (!key) return res.status(400).json({ error: 'Enter an email or phone.' });
  const result = recordSave(db, key, req.body.item_id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.delete('/saves', (req, res) => {
  const key = identity(req);
  if (!key) return res.status(400).json({ error: 'Enter an email or phone.' });
  res.json(removeSave(db, key, req.body.item_id));
});

router.post('/personalise/correct', (req, res) => {
  const key = identity(req);
  if (!key) return res.status(400).json({ error: 'Enter an email or phone.' });
  const signal = req.body.signal > 0 ? 1 : -1;
  const result = recordCorrection(db, key, req.body.item_id, signal);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/personalise/reset', (req, res) => {
  const key = identity(req);
  if (!key) return res.status(400).json({ error: 'Enter an email or phone.' });
  res.json(resetGuest(db, key));
});

module.exports = router;

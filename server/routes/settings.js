'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/settings', (req, res) => {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!row) return res.json({ name: 'SbyNhamHub', phone: '', address: '', hours: [] });
  let hours = [];
  try { hours = JSON.parse(row.hours); } catch { hours = []; }
  res.json({ name: row.name, phone: row.phone, address: row.address, hours });
});

router.patch('/settings', requireAuth, (req, res) => {
  const { name, phone, address, hours } = req.body || {};
  const current = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!current) return res.status(404).json({ error: 'Settings not found' });
  const next = {
    name: name !== undefined ? String(name).trim() : current.name,
    phone: phone !== undefined ? String(phone).trim() : current.phone,
    address: address !== undefined ? String(address).trim() : current.address,
    hours: hours !== undefined ? JSON.stringify(hours) : current.hours
  };
  if (next.hours.length > 10000) return res.status(400).json({ error: 'Hours data is too long' });
  db.prepare("UPDATE settings SET name = ?, phone = ?, address = ?, hours = ?, updated_at = datetime('now') WHERE id = 1").run(
    next.name, next.phone, next.address, next.hours
  );
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  let parsed = [];
  try { parsed = JSON.parse(row.hours); } catch { parsed = []; }
  res.json({ ok: true, settings: { name: row.name, phone: row.phone, address: row.address, hours: parsed } });
});

module.exports = router;

'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/settings', (req, res) => {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!row) return res.json({ name: 'SbyNhamHub', phone: '', address: '', hours: [], avg_cover: 15, fee_rate: 0.0095, fee_flat: 0.5 });
  let hours = [];
  try { hours = JSON.parse(row.hours); } catch { hours = []; }
  res.json({ name: row.name, phone: row.phone, address: row.address, hours, avg_cover: row.avg_cover, fee_rate: row.fee_rate, fee_flat: row.fee_flat });
});

router.patch('/settings', requireAuth, (req, res) => {
  const { name, phone, address, hours, avg_cover, fee_rate, fee_flat } = req.body || {};
  const current = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!current) return res.status(404).json({ error: 'Settings not found' });
  let avgCover = current.avg_cover;
  if (avg_cover !== undefined) {
    avgCover = Number(avg_cover);
    if (!Number.isFinite(avgCover) || avgCover < 0) return res.status(400).json({ error: 'Average cover must be 0 or more' });
  }
  let feeRate = current.fee_rate;
  if (fee_rate !== undefined) {
    feeRate = Number(fee_rate);
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.1) return res.status(400).json({ error: 'Fee rate must be between 0 and 10%' });
  }
  let feeFlat = current.fee_flat;
  if (fee_flat !== undefined) {
    feeFlat = Number(fee_flat);
    if (!Number.isFinite(feeFlat) || feeFlat < 0) return res.status(400).json({ error: 'Flat fee must be 0 or more' });
  }
  const next = {
    name: name !== undefined ? String(name).trim() : current.name,
    phone: phone !== undefined ? String(phone).trim() : current.phone,
    address: address !== undefined ? String(address).trim() : current.address,
    hours: hours !== undefined ? JSON.stringify(hours) : current.hours
  };
  if (next.hours.length > 10000) return res.status(400).json({ error: 'Hours data is too long' });
  db.prepare("UPDATE settings SET name = ?, phone = ?, address = ?, hours = ?, avg_cover = ?, fee_rate = ?, fee_flat = ?, updated_at = datetime('now') WHERE id = 1").run(
    next.name, next.phone, next.address, next.hours, avgCover, feeRate, feeFlat
  );
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  let parsed = [];
  try { parsed = JSON.parse(row.hours); } catch { parsed = []; }
  res.json({ ok: true, settings: { name: row.name, phone: row.phone, address: row.address, hours: parsed, avg_cover: row.avg_cover, fee_rate: row.fee_rate, fee_flat: row.fee_flat } });
});

module.exports = router;

'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth, verifyToken, tokenFrom } = require('../middleware/auth');
const { restaurantId, settingsOf } = require('../lib/restaurants');

const router = express.Router();

function rowToResponse(row, settings) {
  let hours = [];
  try { hours = JSON.parse(row.hours); } catch { hours = []; }
  return {
    name: row.name,
    phone: row.phone,
    address: row.address,
    city: row.city,
    hours,
    avg_cover: Number(row.avg_cover),
    capacity: Number(row.capacity),
    fee_rate: Number(settings.fee_rate),
    fee_flat: Number(settings.fee_flat),
    language: row.language || 'en',
    currency: row.currency || 'USD',
    currency_rate: Number(row.currency_rate || 4100)
  };
}

router.get('/settings', (req, res) => {
  const auth = verifyToken(tokenFrom(req));
  if (auth && auth.restaurant_id) req.restaurant_id = Number(auth.restaurant_id);
  const rid = restaurantId(req);
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(rid);
  if (!row) return res.status(404).json({ error: 'Restaurant not found' });
  res.json(rowToResponse(row, settingsOf(rid)));
});

router.patch('/settings', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  const { name, phone, address, city, hours, avg_cover, fee_rate, fee_flat, capacity, language, currency, currency_rate } = req.body || {};
  const current = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(rid);
  if (!current) return res.status(404).json({ error: 'Restaurant not found' });
  let avgCover = current.avg_cover;
  if (avg_cover !== undefined) {
    avgCover = Number(avg_cover);
    if (!Number.isFinite(avgCover) || avgCover < 0) return res.status(400).json({ error: 'Average cover must be 0 or more' });
  }
  let feeRate = settingsOf(rid).fee_rate;
  if (fee_rate !== undefined) {
    feeRate = Number(fee_rate);
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.1) return res.status(400).json({ error: 'Fee rate must be between 0 and 10%' });
  }
  let feeFlat = settingsOf(rid).fee_flat;
  if (fee_flat !== undefined) {
    feeFlat = Number(fee_flat);
    if (!Number.isFinite(feeFlat) || feeFlat < 0) return res.status(400).json({ error: 'Flat fee must be 0 or more' });
  }
  let seatCapacity = Number(current.capacity || 48);
  if (capacity !== undefined) {
    seatCapacity = Number(capacity);
    if (!Number.isInteger(seatCapacity) || seatCapacity < 1 || seatCapacity > 1000) return res.status(400).json({ error: 'Seat capacity must be between 1 and 1000' });
  }
  const nextLanguage = 'en';
  let nextCurrency = current.currency || 'USD';
  if (currency !== undefined) {
    if (!['USD', 'KHR'].includes(String(currency))) return res.status(400).json({ error: 'Currency must be USD or KHR' });
    nextCurrency = String(currency);
  }
  let nextRate = Number(current.currency_rate || 4100);
  if (currency_rate !== undefined) {
    nextRate = Number(currency_rate);
    if (!Number.isFinite(nextRate) || nextRate <= 0) return res.status(400).json({ error: 'Currency rate must be more than 0' });
  }
  const next = {
    name: name !== undefined ? String(name).trim() : current.name,
    phone: phone !== undefined ? String(phone).trim() : current.phone,
    address: address !== undefined ? String(address).trim() : current.address,
    city: city !== undefined ? String(city).trim() : (current.city || 'Phnom Penh'),
    hours: hours !== undefined ? JSON.stringify(hours) : current.hours
  };
  if (next.hours.length > 10000) return res.status(400).json({ error: 'Hours data is too long' });
  db.prepare("UPDATE restaurants SET name = ?, phone = ?, address = ?, city = ?, hours = ?, avg_cover = ?, capacity = ?, language = ?, currency = ?, currency_rate = ? WHERE id = ?").run(
    next.name, next.phone, next.address, next.city, next.hours, avgCover, seatCapacity, nextLanguage, nextCurrency, nextRate, rid
  );
  db.prepare("UPDATE settings SET fee_rate = ?, fee_flat = ?, updated_at = datetime('now') WHERE id = 1").run(feeRate, feeFlat);
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(rid);
  res.json({ ok: true, settings: rowToResponse(row, settingsOf(rid)) });
});

module.exports = router;

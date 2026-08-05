'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { publicRule, offerFor } = require('../lib/yield');
const { restaurantId } = require('../lib/restaurants');

const router = express.Router();

const TIMES = /^([01]\d|2[0-3]):[0-5]\d$/;

router.get('/yield/rules', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  res.json(db.prepare('SELECT * FROM yield_rules WHERE restaurant_id = ? ORDER BY day_of_week ASC, start_time ASC, id ASC').all(rid).map(publicRule));
});

router.get('/yield/offer', (req, res) => {
  const { date = '', time = '', guests = 1 } = req.query;
  const rid = restaurantId(req);
  const offer = offerFor({ date, time, guests: Number(guests) || 1, restaurantId: rid });
  res.json(offer ? { ...offer, applied: true } : { applied: false });
});

router.post('/yield/rules', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  const { name = '', day_of_week = -1, start_time = '', end_time = '', min_covers = 0, discount_pct = '', label = '', active = 1 } = req.body || {};
  if (!String(name).trim()) return res.status(400).json({ error: 'Rule name is required' });
  const dow = Number(day_of_week);
  if (!Number.isInteger(dow) || dow < -1 || dow > 6) return res.status(400).json({ error: 'Day of week must be between -1 (any day) and 6' });
  if (start_time && !TIMES.test(String(start_time))) return res.status(400).json({ error: 'Invalid start time' });
  if (end_time && !TIMES.test(String(end_time))) return res.status(400).json({ error: 'Invalid end time' });
  if (start_time && end_time && String(start_time) > String(end_time)) return res.status(400).json({ error: 'Start time must be before end time' });
  const covers = Number(min_covers);
  if (!Number.isInteger(covers) || covers < 0) return res.status(400).json({ error: 'Minimum covers must be 0 or more' });
  const pct = Number(discount_pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return res.status(400).json({ error: 'Discount must be between 1% and 50%' });
  const id = Number(db.prepare(
    `INSERT INTO yield_rules (name, day_of_week, start_time, end_time, min_covers, discount_pct, label, active, restaurant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(name).trim(), dow, start_time || null, end_time || null, covers, pct,
    String(label || '').trim(), active ? 1 : 0, rid
  ).lastInsertRowid);
  res.status(201).json({ ok: true, rule: publicRule(db.prepare('SELECT * FROM yield_rules WHERE id = ?').get(id)) });
});

router.patch('/yield/rules/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const rid = restaurantId(req);
  const existing = db.prepare('SELECT * FROM yield_rules WHERE id = ? AND restaurant_id = ?').get(id, rid);
  if (!existing) return res.status(404).json({ error: 'Yield rule not found' });
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return res.status(400).json({ error: 'Rule name is required' });
    patch.name = String(body.name).trim();
  }
  if (body.day_of_week !== undefined) {
    const dow = Number(body.day_of_week);
    if (!Number.isInteger(dow) || dow < -1 || dow > 6) return res.status(400).json({ error: 'Day of week must be between -1 (any day) and 6' });
    patch.day_of_week = dow;
  }
  if (body.start_time !== undefined) {
    if (body.start_time && !TIMES.test(String(body.start_time))) return res.status(400).json({ error: 'Invalid start time' });
    patch.start_time = body.start_time || null;
  }
  if (body.end_time !== undefined) {
    if (body.end_time && !TIMES.test(String(body.end_time))) return res.status(400).json({ error: 'Invalid end time' });
    patch.end_time = body.end_time || null;
  }
  if (body.min_covers !== undefined) {
    const covers = Number(body.min_covers);
    if (!Number.isInteger(covers) || covers < 0) return res.status(400).json({ error: 'Minimum covers must be 0 or more' });
    patch.min_covers = covers;
  }
  if (body.discount_pct !== undefined) {
    const pct = Number(body.discount_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return res.status(400).json({ error: 'Discount must be between 1% and 50%' });
    patch.discount_pct = pct;
  }
  if (body.label !== undefined) patch.label = String(body.label || '').trim();
  if (body.active !== undefined) patch.active = body.active ? 1 : 0;
  const sets = Object.keys(patch).map((key) => `${key} = ?`);
  if (sets.length) db.prepare(`UPDATE yield_rules SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(patch), id);
  res.json({ ok: true, rule: publicRule(db.prepare('SELECT * FROM yield_rules WHERE id = ?').get(id)) });
});

router.delete('/yield/rules/:id', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  const result = db.prepare('DELETE FROM yield_rules WHERE id = ? AND restaurant_id = ?').run(Number(req.params.id), rid);
  if (!result.changes) return res.status(404).json({ error: 'Yield rule not found' });
  res.json({ ok: true });
});

module.exports = router;

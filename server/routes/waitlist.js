'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { VALID_OCCASIONS } = require('../constants');
const { restaurantId, getRestaurant } = require('../lib/restaurants');

const router = express.Router();

router.post('/waitlist', (req, res) => {
  const rid = Number(req.body.restaurant_id) || (req.body.restaurant ? (getRestaurant(req.body.restaurant)?.id || 1) : restaurantId(req));
  const { name = '', phone = '', email = '', party_size = '', preferred_date = '', preferred_time = '', notes = '' } = req.body;
  const errs = [];
  if (!String(name).trim()) errs.push('name');
  if (!String(phone).trim()) errs.push('phone');
  const n = Number(party_size);
  if (!Number.isInteger(n) || n < 1 || n > 20) errs.push('party_size');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(preferred_date))) errs.push('preferred_date');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(preferred_time))) errs.push('preferred_time');
  if (errs.length) return res.status(400).json({ error: 'Invalid fields: ' + errs.join(', ') });

  const result = db
    .prepare(
      `INSERT INTO waitlist (name, phone, email, party_size, preferred_date, preferred_time, notes, restaurant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(String(name).trim(), String(phone).trim(), String(email || '').trim(), n, preferred_date, preferred_time, String(notes || '').trim(), rid);

  const row = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ok: true, entry: row });
});

router.get('/waitlist', requireAuth, (req, res) => {
  const { date } = req.query;
  const rid = restaurantId(req);
  let sql = 'SELECT * FROM waitlist';
  const params = [];
  const where = ['restaurant_id = ?'];
  params.push(rid);
  if (date) {
    where.push('preferred_date = ?');
    params.push(date);
  }
  sql += ' WHERE ' + where.join(' AND ') + ' ORDER BY preferred_date ASC, preferred_time ASC, id ASC';
  res.json(db.prepare(sql).all(...params));
});

router.patch('/waitlist/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const rid = restaurantId(req);
  const { status } = req.body;
  if (!['waiting', 'notified', 'seated', 'cancelled'].includes(String(status))) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const result = db.prepare('UPDATE waitlist SET status = ? WHERE id = ? AND restaurant_id = ?').run(String(status), id, rid);
  if (!result.changes) return res.status(404).json({ error: 'Waitlist entry not found' });
  const row = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(id);
  res.json({ ok: true, entry: row });
});

router.delete('/waitlist/:id', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  const result = db.prepare('DELETE FROM waitlist WHERE id = ? AND restaurant_id = ?').run(Number(req.params.id), rid);
  if (!result.changes) return res.status(404).json({ error: 'Waitlist entry not found' });
  res.json({ ok: true });
});

module.exports = router;

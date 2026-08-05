'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { restaurantId } = require('../lib/restaurants');

const router = express.Router();

function publicTable(row) {
  return {
    id: Number(row.id),
    name: row.name,
    seats: Number(row.seats),
    zone: row.zone || 'main',
    shape: row.shape || 'round',
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    rotation: Number(row.rotation) || 0,
    active: Number(row.active),
    created_at: row.created_at
  };
}

router.get('/tables', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  res.json(db.prepare('SELECT * FROM tables WHERE restaurant_id = ? ORDER BY id ASC').all(rid).map(publicTable));
});

router.post('/tables', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  const { name = '', seats = 4, zone = 'main', shape = 'round', x = 0, y = 0, rotation = 0, active = 1 } = req.body || {};
  const clean = String(name).trim();
  if (!clean) return res.status(400).json({ error: 'Table name is required' });
  if (!/^[A-Za-z0-9 .-]{1,20}$/.test(clean)) return res.status(400).json({ error: 'Invalid table name' });
  const n = Number(seats);
  if (!Number.isInteger(n) || n < 1 || n > 20) return res.status(400).json({ error: 'Seats must be between 1 and 20' });
  if (db.prepare('SELECT id FROM tables WHERE name = ? AND restaurant_id = ?').get(clean, rid)) return res.status(400).json({ error: 'A table with that name already exists' });
  const id = Number(db.prepare(
    'INSERT INTO tables (name, seats, zone, shape, x, y, rotation, active, restaurant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(clean, n, String(zone || 'main'), String(shape || 'round'), Number(x) || 0, Number(y) || 0, Number(rotation) || 0, active ? 1 : 0, rid).lastInsertRowid);
  res.status(201).json({ ok: true, table: publicTable(db.prepare('SELECT * FROM tables WHERE id = ?').get(id)) });
});

router.patch('/tables/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const rid = restaurantId(req);
  const existing = db.prepare('SELECT * FROM tables WHERE id = ? AND restaurant_id = ?').get(id, rid);
  if (!existing) return res.status(404).json({ error: 'Table not found' });
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) {
    const clean = String(body.name).trim();
    if (!clean) return res.status(400).json({ error: 'Table name is required' });
    if (!/^[A-Za-z0-9 .-]{1,20}$/.test(clean)) return res.status(400).json({ error: 'Invalid table name' });
    if (db.prepare('SELECT id FROM tables WHERE name = ? AND restaurant_id = ? AND id != ?').get(clean, rid, id)) return res.status(400).json({ error: 'A table with that name already exists' });
    patch.name = clean;
  }
  if (body.seats !== undefined) {
    const n = Number(body.seats);
    if (!Number.isInteger(n) || n < 1 || n > 20) return res.status(400).json({ error: 'Seats must be between 1 and 20' });
    patch.seats = n;
  }
  if (body.zone !== undefined) patch.zone = String(body.zone || 'main');
  if (body.shape !== undefined) patch.shape = String(body.shape || 'round');
  if (body.x !== undefined) patch.x = Number(body.x) || 0;
  if (body.y !== undefined) patch.y = Number(body.y) || 0;
  if (body.rotation !== undefined) patch.rotation = Number(body.rotation) || 0;
  if (body.active !== undefined) patch.active = body.active ? 1 : 0;
  const sets = Object.keys(patch).map((key) => `${key} = ?`);
  if (sets.length) db.prepare(`UPDATE tables SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(patch), id);
  res.json({ ok: true, table: publicTable(db.prepare('SELECT * FROM tables WHERE id = ?').get(id)) });
});

router.delete('/tables/:id', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  const result = db.prepare('DELETE FROM tables WHERE id = ? AND restaurant_id = ?').run(Number(req.params.id), rid);
  if (!result.changes) return res.status(404).json({ error: 'Table not found' });
  res.json({ ok: true });
});

module.exports = router;

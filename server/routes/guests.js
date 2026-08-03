'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { guestId } = require('../format');

const router = express.Router();

router.get('/guests', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM reservations ORDER BY created_at ASC').all();
  const grouped = new Map();
  for (const item of rows) {
    const id = guestId(item.email, item.phone);
    const current = grouped.get(id) || { id, name: item.name, email: item.email, phone: item.phone, visits: [], preferences: '' };
    current.visits.push(item);
    grouped.set(id, current);
  }
  const guests = [...grouped.values()].map((guest) => {
    guest.visits.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    guest.total_bookings = guest.visits.length;
    guest.last_visit = guest.visits.at(-1)?.date || '';
    const profile = db.prepare('SELECT preferences FROM guest_profiles WHERE guest_key = ?').get(guest.id);
    guest.preferences = profile?.preferences || '';
    const account = db.prepare('SELECT balance FROM points_accounts WHERE guest_key = ?').get(guest.id);
    guest.points = account?.balance || 0;
    return guest;
  });
  res.json(guests);
});

router.patch('/guests/:id', requireAuth, (req, res) => {
  const id = String(req.params.id);
  const { preferences = '' } = req.body;
  if (String(preferences).length > 1000) return res.status(400).json({ error: 'Preferences are too long' });
  db.prepare(
    `INSERT INTO guest_profiles (guest_key, preferences, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(guest_key) DO UPDATE SET preferences = excluded.preferences, updated_at = excluded.updated_at`
  ).run(id, String(preferences).trim());
  res.json({ ok: true });
});

module.exports = router;

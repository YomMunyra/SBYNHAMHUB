'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { guestId } = require('../format');
const { computeBalance } = require('../lib/points');
const { restaurantId } = require('../lib/restaurants');

const router = express.Router();

router.get('/guests', requireAuth, (req, res) => {
  const rid = restaurantId(req);
  const rows = db.prepare('SELECT * FROM reservations WHERE restaurant_id = ? ORDER BY created_at ASC').all(rid);
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
    const profile = db.prepare('SELECT * FROM guest_profiles WHERE guest_key = ?').get(guest.id);
    guest.preferences = profile?.preferences || '';
    guest.dietary = profile?.dietary || '[]';
    guest.allergies = profile?.allergies || '[]';
    guest.favourite_table = profile?.favourite_table || '';
    guest.occasions = profile?.occasions || '[]';
    guest.vip = profile ? Number(profile.vip) : 0;
    const account = db.prepare('SELECT balance FROM points_accounts WHERE guest_key = ?').get(guest.id);
    guest.points = account ? computeBalance(db, guest.id) : 0;
    return guest;
  });
  res.json(guests);
});

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).slice(0, 20);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  return [];
}

router.patch('/guests/:id', requireAuth, (req, res) => {
  const id = String(req.params.id);
  const { preferences = '', dietary, allergies, favourite_table = '', occasions, vip } = req.body || {};
  if (String(preferences).length > 1000) return res.status(400).json({ error: 'Preferences are too long' });
  const dietaryList = parseList(dietary);
  const allergyList = parseList(allergies);
  const occasionsList = parseList(occasions);
  const favTable = String(favourite_table || '').trim().slice(0, 20);
  if (vip !== undefined && ![0, 1, true, false].includes(vip)) return res.status(400).json({ error: 'VIP flag must be true or false' });
  db.prepare(
    `INSERT INTO guest_profiles (guest_key, preferences, dietary, allergies, favourite_table, occasions, vip, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(guest_key) DO UPDATE SET
       preferences = excluded.preferences,
       dietary = excluded.dietary,
       allergies = excluded.allergies,
       favourite_table = excluded.favourite_table,
       occasions = excluded.occasions,
       vip = excluded.vip,
       updated_at = excluded.updated_at`
  ).run(
    id,
    String(preferences).trim(),
    JSON.stringify(dietaryList),
    JSON.stringify(allergyList),
    favTable,
    JSON.stringify(occasionsList),
    vip ? 1 : 0
  );
  const profile = db.prepare('SELECT * FROM guest_profiles WHERE guest_key = ?').get(id);
  res.json({
    ok: true,
    profile: {
      guest_key: id,
      preferences: profile.preferences,
      dietary: profile.dietary,
      allergies: profile.allergies,
      favourite_table: profile.favourite_table,
      occasions: profile.occasions,
      vip: Number(profile.vip)
    }
  });
});

module.exports = router;

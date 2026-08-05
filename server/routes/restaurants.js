'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAdmin } = require('../middleware/auth');
const { publicRestaurant, allRestaurants, getRestaurant, restaurantId } = require('../lib/restaurants');
const { publicPromo, promoApplicable, slotOccupancy } = require('../lib/promos');
const { offerFor } = require('../lib/yield');
const { TIME_SLOTS, VALID_OCCASIONS, CITIES } = require('../constants');

const router = express.Router();

function slugify(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function priceBand(avg) {
  if (avg >= 20) return '$$$$';
  if (avg >= 15) return '$$$';
  if (avg >= 10) return '$$';
  return '$';
}

function availabilityFor(row, { date = '', guests = 1, validParty = false } = {}) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return [];
  const capacity = Number(row.capacity);
  const booked = {};
  for (const r of db.prepare("SELECT time, SUM(guests) AS n FROM reservations WHERE date = ? AND restaurant_id = ? AND status IN ('pending','confirmed','arrived') GROUP BY time").all(String(date), row.id)) {
    booked[r.time] = Number(r.n || 0);
  }
  const now = new Date();
  const isToday = String(date) === now.toISOString().slice(0, 10);
  return TIME_SLOTS.filter((slot) => {
    if (!isToday) return true;
    const [h, m] = slot.split(':').map(Number);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime() > now.getTime() + 15 * 60 * 1000;
  }).map((slot) => {
    const seats = booked[slot] || 0;
    const remaining = capacity - seats;
    let state = 'open';
    if (remaining <= 0) state = 'full';
    else if (validParty && remaining < guests) state = 'limited';
    else if (seats / capacity >= 0.8) state = 'limited';
    const offer = state === 'full' ? null : offerFor({ date, time: slot, guests: validParty ? guests : 1, restaurantId: row.id });
    return { time: slot, booked: seats, remaining, capacity, state, yield: offer ? { label: offer.label, discount_pct: offer.discount_pct, discount: offer.discount } : null };
  });
}

router.get('/marketplace', (req, res) => {
  const { city = '', cuisine = '', max_price = '', min_rating = '', date = '', guests = '', occasion = '' } = req.query;
  const party = Number(guests);
  const validParty = Number.isInteger(party) && party > 0 && party <= 20;
  const ratingFilter = min_rating !== '' && Number.isFinite(Number(min_rating)) && Number(min_rating) > 0 ? Number(min_rating) : 0;
  const maxPrice = max_price !== '' && Number.isFinite(Number(max_price)) && Number(max_price) >= 0 ? Number(max_price) : null;
  const cityFilter = String(city).trim();
  const occasionFilter = String(occasion).trim();

  const restaurants = allRestaurants().map((row) => {
    const matched = (cityFilter ? row.city === cityFilter : true) &&
      (ratingFilter ? (row.rating ?? 0) >= ratingFilter : true);
    return {
      ...row,
      price_band: priceBand(row.avg_cover),
      matched,
      availability: matched ? availabilityFor(row, { date, guests: validParty ? party : 1, validParty }) : []
    };
  });

  let items = [];
  const categories = db.prepare('SELECT id, name, slug FROM categories ORDER BY sort ASC').all();
  if (cuisine) {
    const itemSql = [
      'SELECT m.*, m.restaurant_id AS rid FROM menu_items m JOIN categories c ON c.id = m.category_id',
      'WHERE m.available != 0 AND c.slug = ?'
    ];
    const itemParams = [String(cuisine)];
    if (maxPrice !== null) {
      itemSql.push('AND m.price <= ?');
      itemParams.push(maxPrice);
    }
    itemSql.push('ORDER BY m.featured DESC, m.price ASC LIMIT 40');
    items = db.prepare(itemSql.join(' ')).all(...itemParams);
  } else if (maxPrice !== null) {
    items = db.prepare('SELECT restaurant_id AS rid FROM menu_items WHERE available != 0 AND price <= ? ORDER BY price ASC LIMIT 40').all(maxPrice);
  }
  const dishMatched = new Set(items.map((i) => Number(i.rid)));

  const promos = db
    .prepare('SELECT * FROM promos WHERE active = 1 AND featured = 1')
    .all()
    .filter((p) => promoApplicable(p, { date, time: '', guests: validParty ? party : 1, occasion: occasionFilter }))
    .map((p) => ({ ...publicPromo(p), restaurant_id: Number(p.restaurant_id || 1) }));

  res.json({
    restaurants,
    promos,
    occasions: VALID_OCCASIONS.filter(Boolean),
    cities: CITIES,
    filters: {
      city: cityFilter,
      cuisine: String(cuisine).trim(),
      max_price: maxPrice,
      min_rating: ratingFilter || '',
      date: date || '',
      guests: validParty ? party : '',
      occasion: occasionFilter,
      dish_matched_restaurant_ids: [...dishMatched]
    }
  });
});

router.get('/restaurants/:slug', (req, res) => {
  const row = getRestaurant(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Restaurant not found' });
  const { date = '', guests = '' } = req.query;
  const party = Number(guests);
  const validParty = Number.isInteger(party) && party > 0 && party <= 20;

  const menuSql = `
    SELECT m.*, c.name AS category, c.slug AS category_slug
    FROM menu_items m JOIN categories c ON c.id = m.category_id
    WHERE m.restaurant_id = ? AND m.available != 0
    ORDER BY c.sort ASC, m.featured DESC, m.name ASC
  `;
  const menu = db.prepare(menuSql).all(row.id);
  const grouped = new Map();
  for (const item of menu) {
    const list = grouped.get(item.category_slug) || { name: item.category, slug: item.category_slug, items: [] };
    list.items.push({
      id: item.id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      image: item.image,
      tag: item.tag,
      featured: Number(item.featured)
    });
    grouped.set(item.category_slug, list);
  }

  const promos = db
    .prepare('SELECT * FROM promos WHERE restaurant_id = ? AND active = 1 ORDER BY id DESC').all(row.id)
    .filter((p) => promoApplicable(p, { date, time: '', guests: validParty ? party : 1 }))
    .map(publicPromo);

  const tables = db.prepare('SELECT name, seats FROM tables WHERE restaurant_id = ? AND active = 1 ORDER BY id ASC').all(row.id);

  res.json({
    ...publicRestaurant(row),
    price_band: priceBand(row.avg_cover),
    categories: [...grouped.values()],
    promos,
    tables,
    capacity: Number(row.capacity),
    availability: availabilityFor(row, { date, guests: validParty ? party : 1, validParty }),
    occasions: VALID_OCCASIONS.filter(Boolean)
  });
});

router.get('/restaurants', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM restaurants ORDER BY id ASC').all();
  res.json(rows.map((row) => ({ ...publicRestaurant(row), active: Number(row.active), slug: row.slug })));
});

router.post('/restaurants', requireAdmin, (req, res) => {
  const { name = '', city = 'Phnom Penh', address = '', phone = '', hours = [], avg_cover = 15, capacity = 48, tagline = '', avatar = 'logo.svg' } = req.body || {};
  if (!String(name).trim()) return res.status(400).json({ error: 'Restaurant name is required' });
  let slug = slugify(name) || 'restaurant';
  let base = slug;
  let n = 1;
  while (db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(slug)) {
    slug = `${base}-${n++}`;
  }
  const avg = Number(avg_cover);
  if (!Number.isFinite(avg) || avg < 0) return res.status(400).json({ error: 'Average cover must be 0 or more' });
  const cap = Number(capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > 1000) return res.status(400).json({ error: 'Seat capacity must be between 1 and 1000' });
  const hoursJson = JSON.stringify(Array.isArray(hours) ? hours.slice(0, 12) : []);
  const id = Number(db.prepare(
    `INSERT INTO restaurants (slug, name, city, address, phone, hours, avg_cover, capacity, tagline, avatar, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(slug, String(name).trim(), String(city).trim(), String(address).trim(), String(phone).trim(), hoursJson, avg, cap, String(tagline || '').trim(), String(avatar || 'logo.svg').trim()).lastInsertRowid);
  res.status(201).json({ ok: true, restaurant: publicRestaurant(db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id)) });
});

router.patch('/restaurants/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Restaurant not found' });
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return res.status(400).json({ error: 'Restaurant name is required' });
    patch.name = String(body.name).trim();
  }
  if (body.slug !== undefined) {
    const clean = slugify(body.slug);
    if (!clean) return res.status(400).json({ error: 'Invalid slug' });
    if (db.prepare('SELECT id FROM restaurants WHERE slug = ? AND id != ?').get(clean, id)) return res.status(400).json({ error: 'That slug is already in use' });
    patch.slug = clean;
  }
  if (body.city !== undefined) patch.city = String(body.city).trim();
  if (body.address !== undefined) patch.address = String(body.address).trim();
  if (body.phone !== undefined) patch.phone = String(body.phone).trim();
  if (body.hours !== undefined) patch.hours = JSON.stringify(Array.isArray(body.hours) ? body.hours.slice(0, 12) : []);
  if (body.avg_cover !== undefined) {
    const avg = Number(body.avg_cover);
    if (!Number.isFinite(avg) || avg < 0) return res.status(400).json({ error: 'Average cover must be 0 or more' });
    patch.avg_cover = avg;
  }
  if (body.capacity !== undefined) {
    const cap = Number(body.capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1000) return res.status(400).json({ error: 'Seat capacity must be between 1 and 1000' });
    patch.capacity = cap;
  }
  if (body.tagline !== undefined) patch.tagline = String(body.tagline).trim();
  if (body.avatar !== undefined) patch.avatar = String(body.avatar || 'logo.svg').trim();
  if (body.active !== undefined) patch.active = body.active ? 1 : 0;
  const sets = Object.keys(patch).map((key) => `${key} = ?`);
  if (sets.length) db.prepare(`UPDATE restaurants SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(patch), id);
  const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
  res.json({ ok: true, restaurant: { ...publicRestaurant(row), active: Number(row.active), slug: row.slug } });
});

router.delete('/restaurants/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === 1) return res.status(400).json({ error: 'The home restaurant cannot be removed.' });
  const result = db.prepare('UPDATE restaurants SET active = 0 WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Restaurant not found' });
  res.json({ ok: true });
});

module.exports = router;

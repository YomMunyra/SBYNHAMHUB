'use strict';

const express = require('express');
const { db } = require('../../db');
const { publicItem, publicReview } = require('../format');
const { promoApplicable, publicPromo } = require('../lib/promos');
const { TIME_SLOTS, VALID_OCCASIONS, SEAT_CAPACITY } = require('../constants');

const router = express.Router();

function priceBand(avg) {
  if (avg >= 20) return '$$$$';
  if (avg >= 15) return '$$$';
  if (avg >= 10) return '$$';
  return '$';
}

router.get('/discover', (req, res) => {
  const {
    cuisine = '',
    max_price = '',
    min_rating = '',
    date = '',
    guests = ''
  } = req.query;

  const capacity = Number(db.prepare('SELECT capacity FROM settings WHERE id = 1').get()?.capacity || SEAT_CAPACITY);
  const party = Number(guests);
  const validParty = Number.isInteger(party) && party > 0 && party <= 20;

  const categories = db.prepare('SELECT id, name, slug FROM categories ORDER BY sort ASC').all();

  const itemSql = [
    'SELECT m.*, c.name AS category, c.slug AS category_slug FROM menu_items m JOIN categories c ON c.id = m.category_id',
    'WHERE m.available != 0'
  ];
  const itemParams = [];
  if (cuisine) {
    itemSql.push('AND c.slug = ?');
    itemParams.push(String(cuisine));
  }
  if (max_price !== '' && Number.isFinite(Number(max_price)) && Number(max_price) >= 0) {
    itemSql.push('AND m.price <= ?');
    itemParams.push(Number(max_price));
  }
  itemSql.push('ORDER BY m.featured DESC, c.sort ASC, m.name ASC');
  const items = db.prepare(itemSql.join(' ')).all(...itemParams).map(publicItem);

  const reviews = db.prepare("SELECT * FROM reviews WHERE status = 'published'").all();
  const ratingCount = reviews.length;
  const ratingAvg = ratingCount
    ? Math.round(reviews.reduce((sum, row) => sum + (Number(row.rating_food) + Number(row.rating_service) + Number(row.rating_ambience) + Number(row.rating_value)) / 4, 0) / ratingCount * 10) / 10
    : 0;

  const avgPrices = db.prepare('SELECT AVG(price) AS a FROM menu_items WHERE available != 0').get().a;
  const band = priceBand(Number(avgPrices || 0));

  const promos = db
    .prepare('SELECT * FROM promos WHERE active = 1 AND featured = 1')
    .all()
    .filter((p) => promoApplicable(p, { date, time: '', guests: validParty ? party : 1 }))
    .map(publicPromo);

  let availability = [];
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    const booked = {};
    for (const row of db.prepare("SELECT time, SUM(guests) AS n FROM reservations WHERE date = ? AND status IN ('pending','confirmed','arrived') GROUP BY time").all(String(date))) {
      booked[row.time] = Number(row.n || 0);
    }
    const now = new Date();
    const isToday = String(date) === now.toISOString().slice(0, 10);
    availability = TIME_SLOTS.filter((slot) => {
      if (!isToday) return true;
      const [h, m] = slot.split(':').map(Number);
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime() > now.getTime() + 15 * 60 * 1000;
    }).map((slot) => {
      const seats = booked[slot] || 0;
      const remaining = capacity - seats;
      let state = 'open';
      if (remaining <= 0) state = 'full';
      else if (validParty && remaining < party) state = 'limited';
      else if (seats / capacity >= 0.8) state = 'limited';
      return { time: slot, booked: seats, remaining, capacity, state };
    });
  }

  res.json({
    restaurant: { name: 'SbyNhamHub', address: '123 Riverside Walk, Phnom Penh', cuisine: categories.map((c) => c.name), price_band: band, verified: true },
    rating: { count: ratingCount, avg: ratingAvg },
    categories,
    items,
    promos,
    availability,
    occasions: VALID_OCCASIONS.filter(Boolean),
    capacity,
    filters: { cuisine: cuisine || '', max_price: max_price !== '' ? Number(max_price) : '', min_rating: min_rating !== '' ? Number(min_rating) : '', date: date || '', guests: validParty ? party : '' }
  });
});

module.exports = router;

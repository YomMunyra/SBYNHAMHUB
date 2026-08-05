'use strict';

const express = require('express');
const { db } = require('../../db');
const { publicItem } = require('../format');
const { promoApplicable, publicPromo, slotOccupancy } = require('../lib/promos');
const { offerFor } = require('../lib/yield');
const { restaurantId, getRestaurant } = require('../lib/restaurants');
const { TIME_SLOTS, VALID_OCCASIONS, SEAT_CAPACITY, CITIES } = require('../constants');

const router = express.Router();

function priceBand(avg) {
  if (avg >= 20) return '$$$$';
  if (avg >= 15) return '$$$';
  if (avg >= 10) return '$$';
  return '$';
}

function reviewRating(row) {
  return (Number(row.rating_food) + Number(row.rating_service) + Number(row.rating_ambience) + Number(row.rating_value)) / 4;
}

function averageRating(rid) {
  const reviews = db.prepare("SELECT * FROM reviews WHERE status = 'published' AND restaurant_id = ?").all(rid);
  const count = reviews.length;
  const avg = count
    ? Math.round(reviews.reduce((sum, row) => sum + reviewRating(row), 0) / count * 10) / 10
    : 0;
  return { count, avg };
}

router.get('/discover', (req, res) => {
  const {
    cuisine = '',
    max_price = '',
    min_rating = '',
    date = '',
    guests = '',
    occasion = '',
    city = ''
  } = req.query;

  const rid = restaurantId(req);
  const restaurantRow = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(rid);
  if (!restaurantRow) return res.status(404).json({ error: 'Restaurant not found' });

  const capacity = Number(restaurantRow.capacity || SEAT_CAPACITY);
  const settingsCity = restaurantRow.city || 'Phnom Penh';
  const party = Number(guests);
  const validParty = Number.isInteger(party) && party > 0 && party <= 20;

  const categories = db.prepare('SELECT id, name, slug FROM categories ORDER BY sort ASC').all();

  const itemSql = [
    'SELECT m.*, c.name AS category, c.slug AS category_slug FROM menu_items m JOIN categories c ON c.id = m.category_id',
    'WHERE m.available != 0 AND m.restaurant_id = ?'
  ];
  const itemParams = [rid];
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

  const ratingInfo = averageRating(rid);
  const ratingFilter = min_rating !== '' && Number.isFinite(Number(min_rating)) && Number(min_rating) > 0
    ? Number(min_rating)
    : 0;
  const cityFilter = String(city).trim();
  const ratingMatched = !ratingFilter || ratingInfo.avg >= ratingFilter;
  const cityMatched = !cityFilter || cityFilter === settingsCity;

  const avgPrices = db.prepare('SELECT AVG(price) AS a FROM menu_items WHERE available != 0 AND restaurant_id = ?').get(rid).a;
  const band = priceBand(Number(restaurantRow.avg_cover || 15));

  const occasionFilter = String(occasion).trim();
  const promos = db
    .prepare('SELECT * FROM promos WHERE active = 1 AND featured = 1 AND restaurant_id = ?')
    .all(rid)
    .filter((p) => promoApplicable(p, { date, time: '', guests: validParty ? party : 1, occasion: occasionFilter }))
    .map(publicPromo);

  let availability = [];
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    const booked = {};
    for (const row of db.prepare("SELECT time, SUM(guests) AS n FROM reservations WHERE date = ? AND restaurant_id = ? AND status IN ('pending','confirmed','arrived') GROUP BY time").all(String(date), rid)) {
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
      const offer = state === 'full' ? null : offerFor({ date, time: slot, guests: validParty ? party : 1, restaurantId: rid });
      return { time: slot, booked: seats, remaining, capacity, state, yield: offer ? { label: offer.label, discount_pct: offer.discount_pct, discount: offer.discount } : null };
    });
  }

  res.json({
    restaurant: {
      id: rid,
      slug: restaurantRow.slug,
      name: restaurantRow.name,
      address: restaurantRow.address,
      phone: restaurantRow.phone,
      city: settingsCity,
      cuisine: categories.map((c) => c.name),
      price_band: band,
      verified: true
    },
    rating: ratingInfo,
    categories,
    items,
    promos,
    availability,
    occasions: VALID_OCCASIONS.filter(Boolean),
    cities: CITIES,
    capacity,
    matched: ratingMatched && cityMatched,
    filters: {
      cuisine: cuisine || '',
      max_price: max_price !== '' ? Number(max_price) : '',
      min_rating: ratingFilter || '',
      date: date || '',
      guests: validParty ? party : '',
      occasion: occasionFilter,
      city: cityFilter
    }
  });
});

module.exports = router;

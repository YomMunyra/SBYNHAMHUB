'use strict';

const { db } = require('../../db');

function publicRestaurant(row) {
  if (!row) return null;
  let hours = [];
  try { hours = JSON.parse(row.hours); } catch { hours = []; }
  const reviews = db
    .prepare("SELECT rating_food, rating_service, rating_ambience, rating_value FROM reviews WHERE restaurant_id = ? AND status = 'published'")
    .all(row.id);
  const count = reviews.length;
  const avg = count
    ? reviews.reduce((sum, r) => sum + Math.round((r.rating_food + r.rating_service + r.rating_ambience + r.rating_value) / 4), 0) / count
    : 0;
  const menuCount = Number(db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = ?').get(row.id).n);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    address: row.address,
    phone: row.phone,
    hours,
    avg_cover: Number(row.avg_cover),
    capacity: Number(row.capacity),
    tagline: row.tagline,
    avatar: row.avatar,
    rating: count ? Math.round(avg * 10) / 10 : null,
    reviews_count: count,
    menu_count: menuCount,
    featured: Number(row.featured || 0),
    promoted: Number(row.featured || 0) === 1,
    status: row.status || 'approved',
    language: row.language || 'en',
    currency: row.currency || 'USD',
    currency_rate: Number(row.currency_rate || 4100)
  };
}

function allRestaurants() {
  return db.prepare("SELECT * FROM restaurants WHERE active = 1 AND status = 'approved' ORDER BY featured DESC, id ASC").all().map(publicRestaurant);
}

function getRestaurant(value) {
  if (value === undefined || value === null || value === '') return null;
  if (/^\d+$/.test(String(value))) {
    return db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(value)) || null;
  }
  return db.prepare('SELECT * FROM restaurants WHERE slug = ?').get(String(value)) || null;
}

function restaurantId(req) {
  const raw = req && (req.query.restaurant ?? req.query.restaurant_id);
  if (raw !== undefined && raw !== null && raw !== '') {
    const row = getRestaurant(raw);
    if (row) return Number(row.id);
  }
  if (req && req.restaurant_id) return Number(req.restaurant_id);
  return 1;
}

function restaurantWhere(alias, rid) {
  const a = alias ? alias + '.' : '';
  return `${a}restaurant_id = ?`;
}

function settingsOf(rid) {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const rest = db.prepare('SELECT language, currency, currency_rate FROM restaurants WHERE id = ?').get(rid) || {};
  return {
    name: row?.name || 'SbyNhamHub',
    phone: row?.phone || '',
    address: row?.address || '',
    city: row?.city || 'Phnom Penh',
    hours: (() => { try { return JSON.parse(row?.hours || '[]'); } catch { return []; } })(),
    avg_cover: Number(row?.avg_cover || 15),
    fee_rate: Number(row?.fee_rate ?? 0.0095),
    fee_flat: Number(row?.fee_flat ?? 0.5),
    capacity: Number(row?.capacity || 48),
    language: rest.language || 'en',
    currency: rest.currency || 'USD',
    currency_rate: Number(rest.currency_rate || 4100)
  };
}

module.exports = { publicRestaurant, allRestaurants, getRestaurant, restaurantId, restaurantWhere, settingsOf };

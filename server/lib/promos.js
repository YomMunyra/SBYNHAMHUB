'use strict';

const { db } = require('../../db');
const { SEAT_CAPACITY } = require('../constants');
const { settingsOf } = require('./restaurants');

function parseDays(promo) {
  try {
    const arr = JSON.parse(promo.days);
    return Array.isArray(arr) ? arr.map(Number) : [];
  } catch {
    return [];
  }
}

function slotOccupancy(date, time, restaurantId = 1) {
  if (!date || !time) return null;
  const seats = db
    .prepare("SELECT COALESCE(SUM(guests), 0) AS n FROM reservations WHERE date = ? AND time = ? AND restaurant_id = ? AND status IN ('pending','confirmed','arrived')")
    .get(String(date), String(time), Number(restaurantId)).n;
  const capacity = Number(db.prepare('SELECT capacity FROM restaurants WHERE id = ?').get(Number(restaurantId))?.capacity ?? settingsOf(1).capacity ?? SEAT_CAPACITY);
  return { seats: Number(seats), capacity };
}

function slotIsFull(date, time, restaurantId = 1) {
  const occ = slotOccupancy(date, time, restaurantId);
  return !!occ && occ.seats >= occ.capacity;
}

function discountLabel(promo) {
  return promo.type === 'percent'
    ? `${Number(promo.value)}% off`
    : `$${Number(promo.value).toFixed(2)} off`;
}

function parseOccasions(promo) {
  try {
    const arr = JSON.parse(promo.occasions);
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function publicPromo(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code || '',
    type: row.type,
    value: row.value,
    discount_label: discountLabel(row),
    min_covers: row.min_covers,
    days: parseDays(row),
    start_time: row.start_time || '',
    end_time: row.end_time || '',
    used: row.used,
    max_uses: row.max_uses,
    auto_end: Number(row.auto_end || 0),
    occasions: parseOccasions(row)
  };
}

function promoApplicable(row, { date = '', time = '', guests = 1, occasion = '' } = {}) {
  if (!Number(row.active)) return false;
  if (row.max_uses > 0 && Number(row.used) >= Number(row.max_uses)) return false;
  if (row.start_date && String(row.start_date) > String(date)) return false;
  if (row.end_date && String(row.end_date) < String(date)) return false;
  if (row.min_covers > 0 && Number(guests) < Number(row.min_covers)) return false;
  const days = parseDays(row);
  if (days.length && date) {
    const dow = new Date(String(date) + 'T12:00:00').getDay();
    if (!days.includes(dow)) return false;
  }
  if (row.start_time && String(time) < String(row.start_time)) return false;
  if (row.end_time && String(time) > String(row.end_time)) return false;
  if (Number(row.auto_end) && slotIsFull(date, time, Number(row.restaurant_id || 1))) return false;
  const occasions = parseOccasions(row);
  if (occasions.length && occasion) {
    if (!occasions.includes(String(occasion))) return false;
  }
  return true;
}

function discountFor(promo, { guests = 1, avgCover = 15 } = {}) {
  if (promo.type === 'flat') return Number(promo.value);
  const bill = Number(guests) * Number(avgCover);
  return Math.round(bill * (Number(promo.value) / 100) * 100) / 100;
}

function findPromoByCode(code, restaurantId = 1) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return db.prepare('SELECT * FROM promos WHERE code = ? AND restaurant_id = ?').get(clean, Number(restaurantId)) || null;
}

function redeemPromo(id) {
  const result = db
    .prepare('UPDATE promos SET used = used + 1 WHERE id = ? AND (max_uses = 0 OR used < max_uses)')
    .run(Number(id));
  return result.changes > 0;
}

function resolvePromo({ code = '', date = '', time = '', guests = 1, avgCover = 15, restaurantId = 1 } = {}) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return { promo: null, discount: 0 };
  const promo = findPromoByCode(clean, restaurantId);
  if (!promo) return { error: 'That promo code is not valid.' };
  if (Number(promo.auto_end) && slotIsFull(date, time, restaurantId)) {
    return { error: 'That promo has ended — the restaurant is at capacity for this slot.' };
  }
  if (!promoApplicable(promo, { date, time, guests })) {
    if (promo.max_uses > 0 && Number(promo.used) >= Number(promo.max_uses)) {
      return { error: 'That promo has reached its usage limit.' };
    }
    return { error: 'That promo does not apply to your date, time or party size.' };
  }
  return { promo, discount: discountFor(promo, { guests, avgCover }), code: clean };
}

module.exports = { parseDays, parseOccasions, discountLabel, publicPromo, promoApplicable, discountFor, findPromoByCode, redeemPromo, resolvePromo, slotOccupancy, slotIsFull };

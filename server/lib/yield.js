'use strict';

const { db } = require('../../db');
const { slotOccupancy } = require('./promos');
const { settingsOf } = require('./restaurants');

function publicRule(row) {
  return {
    id: row.id,
    name: row.name,
    day_of_week: Number(row.day_of_week),
    start_time: row.start_time || '',
    end_time: row.end_time || '',
    min_covers: Number(row.min_covers),
    discount_pct: Number(row.discount_pct),
    label: row.label || '',
    active: Number(row.active),
    created_at: row.created_at
  };
}

function parseTime(t) {
  const m = String(t || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function capacityOf(restaurantId = 1) {
  return Number(db.prepare('SELECT capacity FROM restaurants WHERE id = ?').get(Number(restaurantId))?.capacity ?? settingsOf(1).capacity ?? 48);
}

function avgCoverOf(restaurantId = 1) {
  return Number(db.prepare('SELECT avg_cover FROM restaurants WHERE id = ?').get(Number(restaurantId))?.avg_cover ?? settingsOf(1).avg_cover ?? 15);
}

function allRules(restaurantId = 1) {
  return db.prepare('SELECT * FROM yield_rules WHERE restaurant_id = ? ORDER BY day_of_week ASC, start_time ASC, id ASC').all(Number(restaurantId)).map(publicRule);
}

function offerFor({ date = '', time = '', guests = 1, restaurantId = 1 } = {}) {
  if (!date || !time) return null;
  const t = parseTime(time);
  if (t === null) return null;
  const rules = db.prepare('SELECT * FROM yield_rules WHERE active = 1 AND restaurant_id = ?').all(Number(restaurantId));
  if (!rules.length) return null;
  const dow = new Date(String(date) + 'T12:00:00').getDay();
  const occ = slotOccupancy(date, time, restaurantId);
  const seats = occ ? Number(occ.seats) : 0;
  const capacity = capacityOf(restaurantId);
  for (const rule of rules) {
    if (rule.day_of_week >= 0 && Number(rule.day_of_week) !== dow) continue;
    if (rule.start_time) {
      const s = parseTime(rule.start_time);
      if (s !== null && t < s) continue;
    }
    if (rule.end_time) {
      const e = parseTime(rule.end_time);
      if (e !== null && t > e) continue;
    }
    if (rule.min_covers > 0 && Number(guests) < Number(rule.min_covers)) continue;
    if (seats >= capacity) continue;
    const pct = Number(rule.discount_pct);
    const discount = Math.round(Number(guests) * avgCoverOf(restaurantId) * (pct / 100) * 100) / 100;
    return {
      rule: publicRule(rule),
      discount_pct: pct,
      discount,
      label: rule.label || `${pct}% off`
    };
  }
  return null;
}

module.exports = { publicRule, allRules, offerFor, parseTime, capacityOf, avgCoverOf };

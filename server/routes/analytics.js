'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { reviewOverall } = require('../format');

const router = express.Router();

router.get('/analytics', requireAuth, (req, res) => {
  const all = db.prepare('SELECT * FROM reservations').all();

  const today = new Date();
  const trend = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const day = all.filter((r) => r.date === date);
    trend.push({ date, bookings: day.length, covers: day.reduce((sum, r) => sum + r.guests, 0) });
  }

  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDay = dowNames.map((day, i) => ({
    day,
    bookings: all.filter((r) => new Date(r.date + 'T12:00:00').getDay() === i).length
  }));

  const hourMap = {};
  for (const r of all) hourMap[r.time] = (hourMap[r.time] || 0) + 1;
  const byHour = Object.entries(hourMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, count]) => ({ time, count }));

  const occasionMap = {};
  for (const r of all) if (r.occasion) occasionMap[r.occasion] = (occasionMap[r.occasion] || 0) + 1;
  const topOccasions = Object.entries(occasionMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  const closed = all.filter((r) => ['cancelled', 'no-show'].includes(r.status));
  const noShowRate = all.length ? Math.round((closed.length / all.length) * 100) : 0;

  const pointsEarned = db.prepare('SELECT COALESCE(SUM(lifetime), 0) AS n FROM points_accounts').get().n;
  const pointsRedeemed = db.prepare("SELECT COALESCE(SUM(-delta), 0) AS n FROM points_ledger WHERE reason = 'redeemed'").get().n;
  const promoDiscount = db.prepare('SELECT COALESCE(SUM(promo_discount), 0) AS n FROM reservations').get().n;
  const discountTotal = db.prepare('SELECT COALESCE(SUM(discount), 0) AS n FROM reservations').get().n;
  const promoUses = db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE promo_id != 0').get().n;
  const topPromos = db
    .prepare(
      `SELECT promo_name AS name, COUNT(*) AS uses, SUM(promo_discount) AS discount
       FROM reservations WHERE promo_id != 0 GROUP BY promo_id ORDER BY uses DESC LIMIT 5`
    )
    .all();

  const published = db.prepare("SELECT * FROM reviews WHERE status = 'published'").all();
  const reviewAvg = published.length ? published.reduce((sum, r) => sum + reviewOverall(r), 0) / published.length : 0;

  res.json({
    totals: {
      bookings: all.length,
      covers: all.reduce((sum, r) => sum + r.guests, 0),
      arrivals: all.filter((r) => r.status === 'arrived').length,
      confirmed: all.filter((r) => r.status === 'confirmed').length,
      closed
    },
    trend,
    byDay,
    byHour,
    topOccasions,
    noShowRate,
    points: { earned: pointsEarned, redeemed: pointsRedeemed, discount: discountTotal - promoDiscount },
    promos: { uses: promoUses, discount: Math.round(promoDiscount * 100) / 100, top: topPromos },
    reviews: { count: published.length, avg: Math.round(reviewAvg * 10) / 10 }
  });
});

module.exports = router;

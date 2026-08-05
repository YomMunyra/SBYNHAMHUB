'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAdmin } = require('../middleware/auth');
const { restaurantId, publicRestaurant } = require('../lib/restaurants');

const router = express.Router();

router.get('/admin/summary', requireAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rid = restaurantId(req);
  const total = db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE restaurant_id = ?').get(rid).n;
  const todayCount = db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE restaurant_id = ? AND date = ?').get(rid, today).n;
  const covers = db.prepare('SELECT COALESCE(SUM(guests), 0) AS n FROM reservations WHERE restaurant_id = ? AND date = ?').get(rid, today).n;
  const confirmed = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE restaurant_id = ? AND status = 'confirmed'").get(rid).n;
  const recent = db.prepare('SELECT * FROM reservations WHERE restaurant_id = ? ORDER BY id DESC LIMIT 6').all(rid);
  res.json({ total, today: todayCount, covers_today: covers, confirmed, recent });
});

router.get('/admin/platform', requireAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const restaurants = db.prepare('SELECT * FROM restaurants ORDER BY id ASC').all().map((row) => {
    const rid = row.id;
    const total = db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE restaurant_id = ?').get(rid).n;
    const todayCount = db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE restaurant_id = ? AND date = ?').get(rid, today).n;
    const covers = db.prepare('SELECT COALESCE(SUM(guests), 0) AS n FROM reservations WHERE restaurant_id = ? AND date = ?').get(rid, today).n;
    const menuCount = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = ?').get(rid).n;
    const tableCount = db.prepare('SELECT COUNT(*) AS n FROM tables WHERE restaurant_id = ?').get(rid).n;
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() || {};
    return {
      ...publicRestaurant(row),
      active: Number(row.active),
      featured: Number(row.featured || 0),
      status: row.status || 'approved',
      total_reservations: total,
      today_reservations: todayCount,
      covers_today: covers,
      menu_count: menuCount,
      table_count: tableCount,
      fee_rate: Number(settings.fee_rate ?? 0.0095),
      fee_flat: Number(settings.fee_flat ?? 0.5)
    };
  });
  const totals = restaurants.reduce(
    (acc, r) => {
      acc.total_reservations += r.total_reservations;
      acc.today_reservations += r.today_reservations;
      acc.covers_today += r.covers_today;
      return acc;
    },
    { total_reservations: 0, today_reservations: 0, covers_today: 0, restaurants: restaurants.length }
  );
  res.json({ restaurants, totals });
});

module.exports = router;

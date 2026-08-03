'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/admin/summary', requireAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const total = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
  const todayCount = db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE date = ?').get(today).n;
  const covers = db.prepare('SELECT COALESCE(SUM(guests), 0) AS n FROM reservations WHERE date = ?').get(today).n;
  const confirmed = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status = 'confirmed'").get().n;
  const recent = db.prepare('SELECT * FROM reservations ORDER BY id DESC LIMIT 6').all();
  res.json({ total, today: todayCount, covers_today: covers, confirmed, recent });
});

module.exports = router;

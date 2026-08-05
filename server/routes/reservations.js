'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const {
  VALID_STATUS,
  VALID_OCCASIONS,
  VALID_SOURCES,
  POINTS_PER_COVER,
  POINTS_UNIT,
  POINTS_RATE
} = require('../constants');
const { guestId } = require('../format');
const { sendBookingConfirmation } = require('../lib/mailer');
const { resolvePromo, redeemPromo } = require('../lib/promos');
const { computeBalance, redeemPoints, syncBalance } = require('../lib/points');
const { offerFor } = require('../lib/yield');
const { sendSms } = require('../lib/notify');
const { sendPushToMatches } = require('../lib/push');
const { restaurantId, getRestaurant } = require('../lib/restaurants');

const router = express.Router();

async function fireBookingWebhook(booking) {
  try {
    const raw = db.prepare('SELECT integrations FROM settings WHERE id = 1').get()?.integrations;
    const config = JSON.parse(raw || '{}');
    if (!config.webhook_url) return;
    await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'booking.created', booking })
    });
  } catch { /* webhooks are best-effort */ }
}

function awardPoints(reservation) {
  if (Number(reservation.points_awarded)) return null;
  const key = guestId(reservation.email, reservation.phone);
  const earned = Number(reservation.guests) * POINTS_PER_COVER;
  const account = db.prepare('SELECT id FROM points_accounts WHERE guest_key = ?').get(key);
  if (account) {
    db.prepare(
      `UPDATE points_accounts
       SET balance = balance + ?, lifetime = lifetime + ?,
           name = COALESCE(NULLIF(?, ''), name),
           email = COALESCE(NULLIF(?, ''), email),
           phone = COALESCE(NULLIF(?, ''), phone)
       WHERE guest_key = ?`
    ).run(earned, earned, reservation.name, reservation.email, reservation.phone, key);
  } else {
    db.prepare(
      'INSERT INTO points_accounts (guest_key, name, email, phone, balance, lifetime) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(key, reservation.name, reservation.email, reservation.phone, earned, earned);
  }
  db.prepare(
    `INSERT INTO points_ledger (guest_key, delta, reason, ref_id, note, expires_at, remaining)
     VALUES (?, ?, 'earned', ?, ?, datetime('now', '+18 months'), ?)`
  ).run(key, earned, String(reservation.id), `Arrived booking #${reservation.id}`, earned);
  db.prepare('UPDATE reservations SET points_awarded = 1 WHERE id = ?').run(reservation.id);
  return { key, earned };
}

router.get('/reservations', requireAuth, (req, res) => {
  const { date } = req.query;
  const rid = restaurantId(req);
  let sql = 'SELECT * FROM reservations';
  const params = [];
  const where = [];
  where.push('restaurant_id = ?');
  params.push(rid);
  if (date) {
    where.push('date = ?');
    params.push(date);
  }
  sql += ' WHERE ' + where.join(' AND ') + ' ORDER BY date ASC, time ASC, id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/reservations', (req, res) => {
  const {
    name = '',
    email = '',
    phone = '',
    date = '',
    time = '',
    guests = '',
    occasion = '',
    notes = '',
    redeem_points = '',
    promo_code = '',
    source = 'online',
    sms_opt_in = false
  } = req.body;

  const rid = Number(req.body.restaurant_id) || (req.body.restaurant ? (getRestaurant(req.body.restaurant)?.id || 1) : restaurantId(req));
  const restaurant = getRestaurant(rid);
  if (!restaurant) return res.status(400).json({ error: 'That restaurant was not found.' });

  const errs = [];
  if (!String(name).trim()) errs.push('name');
  if (!String(phone).trim()) errs.push('phone');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) errs.push('date');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) errs.push('time');
  const n = Number(guests);
  if (!Number.isInteger(n) || n < 1 || n > 20) errs.push('guests');
  if (occasion && !VALID_OCCASIONS.includes(String(occasion))) errs.push('occasion');
  if (!VALID_SOURCES.includes(String(source))) errs.push('source');

  if (errs.length) {
    return res.status(400).json({ error: 'Invalid fields: ' + errs.join(', ') });
  }

  const past = date + ' ' + time + ':00';
  if (new Date(past + 'Z').getTime() <= Date.now() - 15 * 60 * 1000) {
    return res.status(400).json({ error: 'Please pick a future date and time.' });
  }

  let points_redeemed = 0;
  let discount = 0;
  let redeemKey = '';
  const rp = Number(redeem_points);
  if (rp) {
    if (!String(email).trim()) return res.status(400).json({ error: 'Add an email to redeem points.' });
    if (!Number.isInteger(rp) || rp < POINTS_UNIT || rp % POINTS_UNIT !== 0) {
      return res.status(400).json({ error: `Points must be a multiple of ${POINTS_UNIT}.` });
    }
    redeemKey = guestId(email, phone);
    const account = db.prepare('SELECT balance FROM points_accounts WHERE guest_key = ?').get(redeemKey);
    const available = account ? computeBalance(db, redeemKey) : 0;
    if (available < rp) {
      return res.status(400).json({ error: 'Not enough points for that email.' });
    }
    discount = (rp / POINTS_UNIT) * POINTS_RATE;
    points_redeemed = rp;
  }

  const avgCover = Number(restaurant.avg_cover) || 15;
  let promo_id = 0;
  let promo_name = '';
  let promo_discount = 0;
  if (String(promo_code).trim()) {
    const resolved = resolvePromo({ code: promo_code, date, time, guests: n, avgCover, restaurantId: rid });
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    promo_id = resolved.promo.id;
    promo_name = resolved.promo.name;
    promo_discount = resolved.discount;
    discount += promo_discount;
  }

  let yield_rule_id = 0;
  let yield_label = '';
  let yield_discount = 0;
  if (!promo_id) {
    const offer = offerFor({ date, time, guests: n, restaurantId: rid });
    if (offer) {
      yield_rule_id = offer.rule.id;
      yield_label = offer.label;
      yield_discount = offer.discount;
      discount += yield_discount;
    }
  }

  const result = db
    .prepare(
      `INSERT INTO reservations (name, email, phone, date, time, guests, occasion, notes, points_redeemed, discount, promo_id, promo_name, promo_discount, yield_rule_id, yield_label, yield_discount, source, sms_opt_in, restaurant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(email).trim(),
      String(phone).trim(),
      date,
      time,
      n,
      occasion || '',
      String(notes || '').trim(),
      points_redeemed,
      discount,
      promo_id,
      promo_name,
      promo_discount,
      yield_rule_id,
      yield_label,
      yield_discount,
      String(source),
      sms_opt_in ? 1 : 0,
      rid
    );

  const id = Number(result.lastInsertRowid);
  if (promo_id) {
    if (!redeemPromo(promo_id)) {
      db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
      return res.status(400).json({ error: 'That promo just reached its usage limit.' });
    }
  }
  if (points_redeemed) {
    redeemPoints(db, redeemKey, points_redeemed, String(id), `Discount $${discount.toFixed(2)} on booking #${id}`);
    syncBalance(db, redeemKey);
  }

  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  sendBookingConfirmation(row).catch(() => {});
  if (Number(row.sms_opt_in)) sendSms(row.phone, `${restaurant.name}: table confirmed for ${row.date} at ${row.time}. Party of ${row.guests}. Ref #${row.id}`).catch(() => {});
  sendPushToMatches({ email: row.email, phone: row.phone }, { title: 'Your table is confirmed', body: `${restaurant.name} · ${row.date} at ${row.time} · Party of ${row.guests}`, tag: `confirmed-${row.id}` }).catch(() => {});
  fireBookingWebhook(row);
  res.status(201).json({ ok: true, reservation: row });
});

router.patch('/reservations/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { status, table } = req.body;
  const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Reservation not found' });
  if (table !== undefined && table !== '') {
    const valid = db.prepare('SELECT name FROM tables WHERE active = 1 AND restaurant_id = ?').all(existing.restaurant_id || 1).map((t) => t.name);
    if (!valid.includes(String(table))) return res.status(400).json({ error: 'Invalid table' });
  }
  if (status !== undefined && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE reservations SET status = COALESCE(?, status), table_name = COALESCE(?, table_name) WHERE id = ?').run(status ?? null, table ?? null, id);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const points = row.status === 'arrived' ? awardPoints(row) : null;
  res.json({ ok: true, reservation: row, points });
});

router.delete('/reservations/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Reservation not found' });
  }
  res.json({ ok: true });
});

router.get('/stats', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rid = restaurantId(req);
  const all = db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE restaurant_id = ?').get(rid).n;
  const todayCount = db
    .prepare('SELECT COUNT(*) AS n FROM reservations WHERE restaurant_id = ? AND date = ?')
    .get(rid, today).n;
  const covers = db
    .prepare('SELECT COALESCE(SUM(guests), 0) AS n FROM reservations WHERE restaurant_id = ? AND date = ?')
    .get(rid, today).n;
  const confirmed = db
    .prepare("SELECT COUNT(*) AS n FROM reservations WHERE restaurant_id = ? AND status = 'confirmed'")
    .get(rid).n;
  const byStatus = db
    .prepare('SELECT status, COUNT(*) AS n FROM reservations WHERE restaurant_id = ? GROUP BY status')
    .all(rid);
  res.json({ total: all, today: todayCount, covers_today: covers, confirmed, by_status: byStatus });
});

module.exports = router;

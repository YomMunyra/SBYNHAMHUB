'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { VALID_REVIEW_STATUS } = require('../constants');
const { publicReview } = require('../format');
const { detectSpam } = require('../lib/spam');
const { guestId } = require('../format');

const router = express.Router();

router.get('/reviews/summary', (req, res) => {
  const rows = db.prepare("SELECT * FROM reviews WHERE status = 'published'").all();
  const count = rows.length;
  const avg = count ? rows.reduce((sum, row) => sum + Math.round((row.rating_food + row.rating_service + row.rating_ambience + row.rating_value) / 4), 0) / count : 0;
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const row of rows) {
    const overall = Math.round((row.rating_food + row.rating_service + row.rating_ambience + row.rating_value) / 4);
    distribution[overall] += 1;
  }
  res.json({ count, avg: Math.round(avg * 10) / 10, distribution });
});

router.get('/reviews', (req, res) => {
  if (req.query.all === '1') {
    return requireAuth(req, res, () => {
      const rows = db.prepare('SELECT * FROM reviews ORDER BY id DESC').all();
      res.json(rows);
    });
  }
  const rows = db.prepare("SELECT * FROM reviews WHERE status = 'published' ORDER BY id DESC").all();
  res.json(rows.map(publicReview));
});

router.post('/reviews', (req, res) => {
  const {
    reservation_id = '',
    contact = '',
    food = '',
    service = '',
    ambience = '',
    value = '',
    comment = ''
  } = req.body;

  const errs = [];
  const rid = Number(reservation_id);
  if (!Number.isInteger(rid) || rid <= 0) errs.push('reservation_id');
  if (!String(contact).trim()) errs.push('contact');
  const ratings = [food, service, ambience, value].map(Number);
  for (const r of ratings) {
    if (!Number.isInteger(r) || r < 1 || r > 5) errs.push('rating');
  }
  if (!String(comment).trim()) errs.push('comment');
  if (String(comment).trim().length > 2000) errs.push('comment length');
  if (errs.length) {
    return res.status(400).json({ error: 'Invalid fields: ' + errs.join(', ') });
  }

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid);
  if (!reservation) {
    return res.status(404).json({ error: 'No booking found with that reference.' });
  }

  const now = new Date();
  const bookingDate = new Date(reservation.date + 'T' + reservation.time + ':00');
  if (bookingDate.getTime() >= now.getTime()) {
    return res.status(400).json({ error: 'Reviews are only possible after your visit.' });
  }
  if (!['arrived', 'confirmed', 'completed'].includes(reservation.status)) {
    return res.status(400).json({ error: 'Only completed visits can be reviewed.' });
  }

  const c = String(contact).trim().toLowerCase();
  const email = String(reservation.email || '').trim().toLowerCase();
  const phone = String(reservation.phone || '').trim();
  if (c !== email && c !== phone) {
    return res.status(403).json({ error: 'That contact does not match the booking.' });
  }

  const existing = db.prepare('SELECT id FROM reviews WHERE reservation_id = ?').get(rid);
  if (existing) {
    return res.status(409).json({ error: 'A review already exists for this booking.' });
  }

  const text = String(comment).trim();
  const gid = guestId(reservation.email, reservation.phone);
  const isDuplicate = db
    .prepare('SELECT * FROM reviews WHERE comment = ?')
    .all(text)
    .some((r) => guestId(r.email, r.phone) === gid);
  const spamReason = detectSpam(text, { isDuplicate });
  const spamFlag = spamReason ? 1 : 0;

  const result = db
    .prepare(
      `INSERT INTO reviews (reservation_id, name, email, phone, rating_food, rating_service, rating_ambience, rating_value, comment, status, spam, spam_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(
      rid,
      String(reservation.name).trim(),
      String(reservation.email || '').trim(),
      String(reservation.phone || '').trim(),
      ratings[0],
      ratings[1],
      ratings[2],
      ratings[3],
      text,
      spamFlag,
      spamReason || ''
    );

  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ok: true, review: publicReview(row) });
});

router.patch('/reviews/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { status, reply, spam, spam_reason } = req.body;
  if (status !== undefined && !VALID_REVIEW_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (reply !== undefined && String(reply).length > 1000) {
    return res.status(400).json({ error: 'Reply is too long' });
  }
  if (spam !== undefined && ![0, 1].includes(Number(spam))) {
    return res.status(400).json({ error: 'Invalid spam flag' });
  }
  const row0 = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  if (!row0) {
    return res.status(404).json({ error: 'Review not found' });
  }
  const newStatus = status ?? row0.status;
  const newReply = reply ?? row0.reply;
  let newSpam = spam !== undefined ? Number(spam) : Number(row0.spam);
  let newReason = String(row0.spam_reason || '');
  if (newStatus === 'published') {
    newSpam = 0;
    newReason = '';
  }
  if (spam !== undefined) {
    newSpam = Number(spam);
    newReason = newSpam ? String(spam_reason || 'Marked by staff') : '';
  }
  db.prepare('UPDATE reviews SET status = ?, reply = ?, spam = ?, spam_reason = ? WHERE id = ?').run(
    newStatus,
    newReply,
    newSpam,
    newReason,
    id
  );
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  res.json({ ok: true, review: row });
});

module.exports = router;

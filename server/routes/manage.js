'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { VALID_STATUS } = require('../constants');
const { sendBookingConfirmation, sendReminder } = require('../lib/mailer');

const router = express.Router();

function contactMatches(reservation, contact) {
  const c = String(contact || '').trim().toLowerCase();
  const email = String(reservation.email || '').trim().toLowerCase();
  const phone = String(reservation.phone || '').trim();
  return !!c && (c === email || c === phone);
}

function findReservation(id) {
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return null;
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid);
}

router.post('/reservations/lookup', (req, res) => {
  const { id = '', contact = '' } = req.body || {};
  const reservation = findReservation(id);
  if (!reservation) return res.status(404).json({ error: 'No booking found with that reference.' });
  if (!contactMatches(reservation, contact)) return res.status(403).json({ error: 'That contact does not match the booking.' });
  res.json({ ok: true, reservation });
});

router.post('/reservations/:id/cancel', async (req, res) => {
  const { contact = '' } = req.body || {};
  const reservation = findReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'No booking found with that reference.' });
  if (!contactMatches(reservation, contact)) return res.status(403).json({ error: 'That contact does not match the booking.' });
  if (['cancelled', 'no-show'].includes(reservation.status)) {
    return res.status(409).json({ error: 'This booking is already closed.' });
  }
  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(reservation.id);
  const updated = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservation.id);
  res.json({ ok: true, reservation: updated });
});

router.patch('/reservations/:id/modify', (req, res) => {
  const { contact = '', date, time, guests } = req.body || {};
  const reservation = findReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'No booking found with that reference.' });
  if (!contactMatches(reservation, contact)) return res.status(403).json({ error: 'That contact does not match the booking.' });
  if (['cancelled', 'no-show'].includes(reservation.status)) {
    return res.status(409).json({ error: 'This booking is already closed.' });
  }
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ error: 'Invalid date' });
  if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) return res.status(400).json({ error: 'Invalid time' });
  if (guests !== undefined) {
    const n = Number(guests);
    if (!Number.isInteger(n) || n < 1 || n > 20) return res.status(400).json({ error: 'Invalid party size' });
  }
  const nextDate = date ?? reservation.date;
  const nextTime = time ?? reservation.time;
  if (new Date(nextDate + 'T' + nextTime + ':00').getTime() <= Date.now() - 15 * 60 * 1000) {
    return res.status(400).json({ error: 'Please pick a future date and time.' });
  }
  db.prepare('UPDATE reservations SET date = ?, time = ?, guests = ? WHERE id = ?').run(
    nextDate,
    nextTime,
    guests !== undefined ? Number(guests) : reservation.guests,
    reservation.id
  );
  const updated = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservation.id);
  sendBookingConfirmation(updated);
  res.json({ ok: true, reservation: updated });
});

router.post('/reminders', requireAuth, async (req, res) => {
  const now = Date.now();
  const rows = db
    .prepare("SELECT * FROM reservations WHERE status IN ('pending','confirmed') AND date >= date('now')")
    .all();
  const sent = [];
  for (const row of rows) {
    const msUntil = new Date(row.date + 'T' + row.time + ':00').getTime() - now;
    const hours = msUntil / 3600000;
    if (hours >= 20 && hours <= 26 && !Number(row.reminder_24h)) {
      await sendReminder(row, 24);
      db.prepare('UPDATE reservations SET reminder_24h = 1 WHERE id = ?').run(row.id);
      sent.push({ id: row.id, kind: '24h' });
    } else if (hours >= 1 && hours <= 3 && !Number(row.reminder_2h)) {
      await sendReminder(row, 2);
      db.prepare('UPDATE reservations SET reminder_2h = 1 WHERE id = ?').run(row.id);
      sent.push({ id: row.id, kind: '2h' });
    }
  }
  res.json({ ok: true, sent, count: sent.length });
});

module.exports = router;

'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { VALID_STATUS } = require('../constants');
const { sendBookingConfirmation } = require('../lib/mailer');
const { processReminders } = require('../lib/scheduler');

const router = express.Router();

const CANCEL_WINDOW_MS = 60 * 60 * 1000;

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

function insideWindow(reservation, now = Date.now()) {
  const start = new Date(reservation.date + 'T' + reservation.time + ':00').getTime();
  return now < start - CANCEL_WINDOW_MS;
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
  if (!insideWindow(reservation)) {
    return res.status(400).json({ error: 'This table is under 1 hour away — bookings can only be cancelled up to 1 hour before. Call us and we will sort it.' });
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
  if (!insideWindow(reservation)) {
    return res.status(400).json({ error: 'This table is under 1 hour away — bookings can only be modified up to 1 hour before. Call us and we will sort it.' });
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
  const sent = await processReminders();
  res.json({ ok: true, sent, count: sent.length });
});

module.exports = router;

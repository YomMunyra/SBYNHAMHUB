'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { round2, paymentRef, computeTip, computeFee, mockProcessCard } = require('../lib/payments');
const { sendPaymentReceipt } = require('../lib/mailer');

const router = express.Router();

function feeSettings() {
  const row = db.prepare('SELECT fee_rate, fee_flat FROM settings WHERE id = 1').get();
  return { feeRate: Number(row?.fee_rate) || 0.0095, feeFlat: Number(row?.fee_flat) || 0.5 };
}

router.get('/payments', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM payments ORDER BY id DESC').all();
  const summary = {
    count: rows.length,
    gross: round2(rows.reduce((sum, r) => sum + r.total, 0)),
    fees: round2(rows.reduce((sum, r) => sum + r.fee_total, 0)),
    tips: round2(rows.reduce((sum, r) => sum + r.tip_amount, 0)),
    net: round2(rows.reduce((sum, r) => sum + r.total - r.fee_total, 0))
  };
  res.json({ summary, payments: rows });
});

router.get('/payments/receipt/:ref', (req, res) => {
  const ref = String(req.params.ref || '').trim().toUpperCase();
  if (!/^NYM-[A-Z0-9]{8}$/.test(ref)) return res.status(400).json({ error: 'Invalid receipt reference.' });
  const payment = db.prepare('SELECT * FROM payments WHERE payment_ref = ?').get(ref);
  if (!payment) return res.status(404).json({ error: 'No payment found with that reference.' });
  const reservation = payment.reservation_id
    ? db.prepare('SELECT * FROM reservations WHERE id = ?').get(payment.reservation_id)
    : null;
  res.json({ payment, reservation });
});

router.post('/payments/pay', (req, res) => {
  const {
    name = '',
    email = '',
    amount = '',
    tip_pct = 0,
    split_across = 1,
    split_index = 1,
    reservation_id = '',
    card = {}
  } = req.body;

  const errs = [];
  if (!String(name).trim()) errs.push('name');
  if (!String(email).trim()) errs.push('email');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 100000) errs.push('amount');
  const tipPct = Number(tip_pct);
  if (!Number.isFinite(tipPct) || tipPct < 0 || tipPct > 25) errs.push('tip');
  const splitAcross = Number(split_across);
  const splitIndex = Number(split_index);
  if (!Number.isInteger(splitAcross) || splitAcross < 1 || splitAcross > 12) errs.push('split_across');
  if (!Number.isInteger(splitIndex) || splitIndex < 1 || splitIndex > splitAcross) errs.push('split_index');
  if (errs.length) return res.status(400).json({ error: 'Invalid fields: ' + errs.join(', ') });

  const processed = mockProcessCard(card);
  if (processed.error) return res.status(400).json({ error: processed.error });

  const { feeRate, feeFlat } = feeSettings();
  const tipAmount = computeTip(amt, tipPct);
  const feeTotal = computeFee(amt, feeRate, feeFlat);
  const total = round2(amt + tipAmount + feeTotal);

  let rid = 0;
  if (String(reservation_id).trim()) {
    rid = Number(reservation_id);
    const reservation = db.prepare('SELECT id FROM reservations WHERE id = ?').get(rid);
    if (!reservation) return res.status(404).json({ error: 'No booking found with that reference.' });
    db.prepare("UPDATE reservations SET status = 'paid' WHERE id = ?").run(rid);
  }

  const result = db
    .prepare(
      `INSERT INTO payments
         (payment_ref, reservation_id, name, email, amount, tip_pct, tip_amount, fee_rate, fee_flat, fee_total, total, split_across, split_index, card_last4)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      paymentRef(), rid || null, String(name).trim(), String(email).trim(), amt, tipPct, tipAmount,
      feeRate, feeFlat, feeTotal, total, splitAcross, splitIndex, processed.last4
    );

  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(result.lastInsertRowid));
  const reservation = rid ? db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid) : null;
  sendPaymentReceipt(row, reservation).catch(() => {});
  res.status(201).json({ ok: true, payment: row });
});

router.post('/payments/:id/refund', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Payment not found' });
  if (existing.status === 'refunded') return res.json({ ok: true, payment: existing });
  db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(id);
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  res.json({ ok: true, payment: row });
});

module.exports = router;

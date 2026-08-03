'use strict';

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function paymentRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'NYM-';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function computeTip(amount, tipPct) {
  return Math.round(Math.round(Number(amount) * 100) * Number(tipPct) / 100) / 100;
}

function computeFee(amount, feeRate, feeFlat) {
  const cents = Math.round(Number(amount) * 100);
  const bps = Math.round(Number(feeRate) * 10000);
  const feeCents = Math.round(cents * bps / 10000) + Math.round(Number(feeFlat) * 100);
  return feeCents / 100;
}

function cardDigits(number) {
  return String(number || '').replace(/[\s-]/g, '');
}

function mockProcessCard(card) {
  const number = cardDigits(card && card.number);
  if (!/^\d{13,19}$/.test(number)) return { error: 'Card number must be 13–19 digits.' };
  const last4 = number.slice(-4);
  if (last4 === '1111') return { error: 'Card declined by issuer. Please try another card.' };

  const expiry = String(card && card.expiry || '').trim();
  const m = expiry.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!m) return { error: 'Expiry must be in MM/YY format.' };
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return { error: 'This card has expired.' };
  }

  const cvc = String(card && card.cvc || '').trim();
  if (!/^\d{3,4}$/.test(cvc)) return { error: 'CVC must be 3–4 digits.' };

  return { ok: true, last4 };
}

module.exports = { round2, paymentRef, computeTip, computeFee, mockProcessCard, cardDigits };

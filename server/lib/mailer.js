'use strict';

let transporter = null;

function mailerReady() {
  if (transporter) return true;
  const host = process.env.SMTP_HOST;
  if (!host) return false;
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
  return true;
}

async function sendEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, dev: true, reason: 'no-recipient' };
  if (!mailerReady()) {
    console.log(`[mailer:dev] To: ${to} | Subject: ${subject} | ${text}`);
    return { sent: false, dev: true, reason: 'smtp-not-configured' };
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"SbyNhamHub" <no-reply@sbynhamhub.com>`,
      to,
      subject,
      text,
      html
    });
    return { sent: true };
  } catch (error) {
    console.error('[mailer:error]', error.message);
    return { sent: false, dev: false, reason: error.message };
  }
}

async function sendBookingConfirmation(reservation) {
  if (!reservation.email) return { sent: false, dev: true, reason: 'no-email' };
  return sendEmail({
    to: reservation.email,
    subject: `Your SbyNhamHub table — ${reservation.date} at ${reservation.time}`,
    text: [
      `Hi ${reservation.name},`,
      `Your table is confirmed at SbyNhamHub.`,
      ``,
      `Booking reference: #${reservation.id}`,
      `Date: ${reservation.date} at ${reservation.time}`,
      `Party: ${reservation.guests}`,
      reservation.occasion ? `Occasion: ${reservation.occasion}` : null,
      reservation.discount ? `Nyam Points: ${reservation.points_redeemed} pts applied — $${reservation.discount.toFixed(2)} off your bill.` : null,
      ``,
      `We'll remind you the day of your visit. Manage or cancel at any time on the booking page.`,
      `See you soon — Taste · Book · Enjoy.`
    ].filter(Boolean).join('\n'),
    html: [
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">`,
      `<h2 style="color:#FF611F">Your table is confirmed</h2>`,
      `<p>Hi <b>${reservation.name}</b>,</p>`,
      `<table style="width:100%;border-collapse:collapse;margin:16px 0">`,
      `<tr><td style="padding:6px 0;color:#888">Booking reference</td><td style="text-align:right"><b>#${reservation.id}</b></td></tr>`,
      `<tr><td style="padding:6px 0;color:#888">Date</td><td style="text-align:right"><b>${reservation.date}</b></td></tr>`,
      `<tr><td style="padding:6px 0;color:#888">Time</td><td style="text-align:right"><b>${reservation.time}</b></td></tr>`,
      `<tr><td style="padding:6px 0;color:#888">Party</td><td style="text-align:right"><b>${reservation.guests}</b></td></tr>`,
      reservation.occasion ? `<tr><td style="padding:6px 0;color:#888">Occasion</td><td style="text-align:right"><b>${reservation.occasion}</b></td></tr>` : '',
      reservation.discount ? `<tr><td style="padding:6px 0;color:#888">Nyam Points</td><td style="text-align:right"><b>${reservation.points_redeemed} pts · $${reservation.discount.toFixed(2)} off</b></td></tr>` : '',
      `</table>`,
      `<p style="color:#888;font-size:13px">We'll remind you the day of your visit. Manage or cancel anytime on the booking page.</p>`,
      `<p style="color:#888;font-size:13px">Taste · Book · Enjoy — SbyNhamHub</p>`,
      `</div>`
    ].join('')
  });
}

async function sendReminder(reservation, hoursBefore) {
  if (!reservation.email) return { sent: false, dev: true, reason: 'no-email' };
  return sendEmail({
    to: reservation.email,
    subject: hoursBefore === 24 ? `Your SbyNhamHub table is tomorrow` : `Your SbyNhamHub table is in ${hoursBefore} hours`,
    text: [
      `Hi ${reservation.name},`,
      hoursBefore === 24
        ? `Just a reminder — your table is tomorrow at ${reservation.time}.`
        : `Just a reminder — your table at SbyNhamHub is in 2 hours at ${reservation.time}.`,
      `Booking reference: #${reservation.id} · Party of ${reservation.guests}.`,
      `Need to change it? Manage or cancel on the booking page.`,
      `See you soon!`
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto"><h3 style="color:#FF611F">Table reminder</h3><p>Hi <b>${reservation.name}</b>,</p><p>${hoursBefore === 24 ? `Your table is <b>tomorrow</b> at <b>${reservation.time}</b>.` : `Your table is in <b>2 hours</b> at <b>${reservation.time}</b>.`}</p><p style="color:#888">Booking reference: <b>#${reservation.id}</b> · Party of ${reservation.guests}.</p><p style="color:#888;font-size:13px">See you soon — SbyNhamHub</p></div>`
  });
}

async function sendPaymentReceipt(payment, reservation) {
  if (!payment || !payment.email) return { sent: false, dev: true, reason: 'no-email' };
  const lines = (p, label) => `<tr><td style="padding:6px 0;color:#888">${label}</td><td style="text-align:right"><b>${p}</b></td></tr>`;
  return sendEmail({
    to: payment.email,
    subject: `Your NyamPay receipt ${payment.payment_ref}`,
    text: [
      `Hi ${payment.name},`,
      `Thanks for dining with us — here is your receipt from SbyNhamHub.`,
      ``,
      `Receipt reference: ${payment.payment_ref}`,
      payment.reservation_id ? `Booking reference: #${payment.reservation_id}` : null,
      `Bill: $${payment.amount.toFixed(2)}`,
      payment.tip_amount ? `Tip (${payment.tip_pct}%): $${payment.tip_amount.toFixed(2)}` : null,
      `NyamPay fee: $${payment.fee_total.toFixed(2)}`,
      `Total: $${payment.total.toFixed(2)}`,
      `Paid by card ending ${payment.card_last4} · ${payment.created_at}`,
      ``,
      `Find this receipt anytime on the SbyNhamHub receipt page.`,
      `Taste · Book · Enjoy.`
    ].filter(Boolean).join('\n'),
    html: [
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">`,
      `<h2 style="color:#FF611F">Your receipt is ready</h2>`,
      `<p>Hi <b>${payment.name}</b>, thanks for dining with us.</p>`,
      `<table style="width:100%;border-collapse:collapse;margin:16px 0">`,
      lines(payment.payment_ref, 'Receipt reference'),
      payment.reservation_id ? lines(`#${payment.reservation_id}`, 'Booking reference') : '',
      lines(`$${payment.amount.toFixed(2)}`, 'Bill'),
      payment.tip_amount ? lines(`$${payment.tip_amount.toFixed(2)} (${payment.tip_pct}%)`, 'Tip') : '',
      lines(`$${payment.fee_total.toFixed(2)}`, 'NyamPay fee'),
      lines(`$${payment.total.toFixed(2)}`, 'Total'),
      lines(`Card ending ${payment.card_last4}`, 'Paid by'),
      lines(String(payment.created_at), 'Date'),
      `</table>`,
      `<p style="color:#888;font-size:13px">Taste · Book · Enjoy — SbyNhamHub</p>`,
      `</div>`
    ].join('')
  });
}

module.exports = { sendBookingConfirmation, sendReminder, sendEmail, sendPaymentReceipt };

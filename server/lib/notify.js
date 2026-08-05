'use strict';

async function sendSms(phone, message) {
  if (!phone) return { sent: false, dev: true, reason: 'no-phone' };
  const url = process.env.SMS_WEBHOOK_URL;
  if (!url) {
    console.log(`[sms:dev] To: ${phone} | ${message}`);
    return { sent: false, dev: true, reason: 'sms-not-configured' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: phone, message, from: process.env.SMS_FROM || 'SbyNhamHub' })
    });
    if (!res.ok) return { sent: false, dev: false, reason: `http-${res.status}` };
    return { sent: true };
  } catch (error) {
    console.error('[sms:error]', error.message);
    return { sent: false, dev: false, reason: error.message };
  }
}

function reminderSmsText(reservation, hoursBefore) {
  const lines = [
    `SbyNhamHub: ${reservation.name},`,
    hoursBefore === 24
      ? `your table is tomorrow at ${reservation.time}.`
      : `your table is in 2 hours at ${reservation.time}.`,
    `Party of ${reservation.guests}. Reply or cancel via the booking page.`,
    `Ref #${reservation.id}`
  ];
  return lines.join(' ');
}

module.exports = { sendSms, reminderSmsText };

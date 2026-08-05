'use strict';

const { db } = require('../../db');
const { sendReminder } = require('./mailer');
const { sendSms, reminderSmsText } = require('./notify');
const { sendPushToMatches } = require('./push');

function integrationsOf() {
  const raw = db.prepare('SELECT integrations FROM settings WHERE id = 1').get()?.integrations;
  try {
    return { webhook_url: '', sms_enabled: true, push_enabled: true, ...JSON.parse(raw || '{}') };
  } catch {
    return { webhook_url: '', sms_enabled: true, push_enabled: true };
  }
}

async function processReminders(now = Date.now()) {
  const rows = db
    .prepare("SELECT * FROM reservations WHERE status IN ('pending','confirmed')")
    .all();
  const config = integrationsOf();
  const sent = [];
  for (const row of rows) {
    const msUntil = new Date(row.date + 'T' + row.time + ':00').getTime() - now;
    const hours = msUntil / 3600000;
    if (hours >= 20 && hours <= 26 && !Number(row.reminder_24h)) {
      await sendReminder(row, 24);
      if (config.sms_enabled && Number(row.sms_opt_in)) await sendSms(row.phone, reminderSmsText(row, 24));
      if (config.push_enabled) await sendPushToMatches({ email: row.email, phone: row.phone }, { title: 'Your SbyNhamHub table is tomorrow', body: `${row.date} at ${row.time} · Party of ${row.guests}`, tag: `reminder-24h-${row.id}` });
      db.prepare('UPDATE reservations SET reminder_24h = 1 WHERE id = ?').run(row.id);
      sent.push({ id: row.id, kind: '24h' });
    } else if (hours >= 1 && hours <= 3 && !Number(row.reminder_2h)) {
      await sendReminder(row, 2);
      if (config.sms_enabled && Number(row.sms_opt_in)) await sendSms(row.phone, reminderSmsText(row, 2));
      if (config.push_enabled) await sendPushToMatches({ email: row.email, phone: row.phone }, { title: 'Your SbyNhamHub table is in 2 hours', body: `${row.date} at ${row.time} · Party of ${row.guests}`, tag: `reminder-2h-${row.id}` });
      db.prepare('UPDATE reservations SET reminder_2h = 1 WHERE id = ?').run(row.id);
      sent.push({ id: row.id, kind: '2h' });
    }
  }
  return sent;
}

function startReminderScheduler(intervalMs = 60 * 1000) {
  const timer = setInterval(async () => {
    try {
      const sent = await processReminders();
      if (sent.length) {
        console.log(`[reminders] sent ${sent.length}: ` + sent.map((s) => `#${s.id} ${s.kind}`).join(', '));
      }
    } catch (error) {
      console.error('[reminders] error', error.message);
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { processReminders, startReminderScheduler };

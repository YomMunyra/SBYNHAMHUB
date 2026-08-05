'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { sendSms } = require('../lib/notify');
const {
  pushSupported,
  getVapid,
  allSubscriptions,
  addSubscription,
  sendPush
} = require('../lib/push');

const router = express.Router();

function integrationsOf() {
  const raw = db.prepare('SELECT integrations FROM settings WHERE id = 1').get()?.integrations;
  try {
    return { webhook_url: '', sms_enabled: true, push_enabled: true, ...JSON.parse(raw || '{}') };
  } catch {
    return { webhook_url: '', sms_enabled: true, push_enabled: true };
  }
}

function saveIntegrations(config) {
  db.prepare("UPDATE settings SET integrations = ? WHERE id = 1").run(JSON.stringify(config));
}

router.get('/integrations', requireAuth, (req, res) => {
  const config = integrationsOf();
  const subscriptions = allSubscriptions();
  res.json({
    webhook_url: config.webhook_url || '',
    sms_enabled: !!config.sms_enabled,
    push_enabled: !!config.push_enabled,
    push_supported: pushSupported(),
    vapid_public_key: getVapid()?.publicKey || '',
    subscriptions: subscriptions.map((s) => ({ id: s.id, endpoint: s.endpoint.slice(0, 60) + '…', email: s.email, phone: s.phone, created_at: s.created_at })),
    subscription_count: subscriptions.length
  });
});

router.patch('/integrations', requireAuth, (req, res) => {
  const { webhook_url, sms_enabled, push_enabled } = req.body || {};
  const config = integrationsOf();
  if (webhook_url !== undefined) {
    const clean = String(webhook_url || '').trim();
    if (clean && !/^https?:\/\//.test(clean)) return res.status(400).json({ error: 'Webhook URL must start with http(s)://' });
    config.webhook_url = clean;
  }
  if (sms_enabled !== undefined) config.sms_enabled = !!sms_enabled;
  if (push_enabled !== undefined) config.push_enabled = !!push_enabled;
  saveIntegrations(config);
  res.json({ ok: true, config: { webhook_url: config.webhook_url || '', sms_enabled: !!config.sms_enabled, push_enabled: !!config.push_enabled } });
});

router.get('/push/vapid', (req, res) => {
  const vapid = getVapid();
  res.json({ supported: pushSupported(), publicKey: vapid?.publicKey || '' });
});

router.post('/push/subscribe', (req, res) => {
  const { endpoint = '', keys = {}, email = '', phone = '' } = req.body || {};
  if (!endpoint || !/^https:\/\//.test(endpoint)) return res.status(400).json({ error: 'A valid push subscription endpoint is required' });
  const id = addSubscription({ endpoint, keys, email, phone });
  res.status(201).json({ ok: true, id });
});

router.post('/push/test', requireAuth, async (req, res) => {
  const config = integrationsOf();
  if (!config.push_enabled) return res.status(400).json({ error: 'Push notifications are disabled' });
  if (!pushSupported()) return res.status(400).json({ error: 'web-push is not installed on the server' });
  const subscriptions = allSubscriptions();
  if (!subscriptions.length) return res.status(400).json({ error: 'No devices are subscribed yet' });
  const results = [];
  for (const subscription of subscriptions) {
    results.push(await sendPush(subscription, { title: 'SbyNhamHub test', body: 'Push notifications are working!', tag: 'test-push' }));
  }
  res.json({ ok: true, sent: results.filter((r) => r.sent).length, total: results.length, results });
});

router.post('/sms/test', requireAuth, async (req, res) => {
  const config = integrationsOf();
  const phone = String((req.body || {}).phone || '').trim();
  if (!config.sms_enabled) return res.status(400).json({ error: 'SMS reminders are disabled' });
  if (!phone) return res.status(400).json({ error: 'A phone number is required to send a test SMS' });
  const result = await sendSms(phone, 'SbyNhamHub: this is a test SMS. SMS reminders are working!');
  res.json({ ok: true, ...result });
});

router.post('/webhook/test', requireAuth, async (req, res) => {
  const config = integrationsOf();
  const url = config.webhook_url;
  if (!url) return res.status(400).json({ error: 'Set a webhook URL first' });
  const payload = {
    event: 'test',
    message: 'SbyNhamHub webhook is working',
    sent_at: new Date().toISOString()
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    res.json({ ok: true, status: response.status, payload });
  } catch (error) {
    res.json({ ok: false, error: error.message, payload });
  }
});

router.post('/webhook/fire', requireAuth, async (req, res) => {
  const config = integrationsOf();
  const url = config.webhook_url;
  if (!url) return res.json({ fired: false });
  const booking = (req.body || {}).booking || {};
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'booking.created', booking })
    });
    return res.json({ fired: true, status: response.status });
  } catch {
    return res.json({ fired: false, status: 0 });
  }
});

module.exports = router;

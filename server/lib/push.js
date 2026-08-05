'use strict';

const { db } = require('../../db');

let webpush = null;

function loadWebPush() {
  if (webpush) return webpush;
  try {
    webpush = require('web-push');
  } catch {
    return null;
  }
  return webpush;
}

function vapidFromEnv() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:ops@sbynhamhub.com';
  if (pub && priv) return { publicKey: pub, privateKey: priv, subject: subj };
  return null;
}

function storedVapid() {
  const raw = db.prepare('SELECT vapid_keys FROM settings WHERE id = 1').get()?.vapid_keys;
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed.publicKey && parsed.privateKey) return { ...parsed, subject: parsed.subject || 'mailto:ops@sbynhamhub.com' };
  } catch { /* corrupted */ }
  return null;
}

function saveVapid(keys) {
  db.prepare("UPDATE settings SET vapid_keys = ? WHERE id = 1").run(JSON.stringify(keys));
}

function getVapid() {
  const wp = loadWebPush();
  if (!wp) return null;
  const fromEnv = vapidFromEnv();
  if (fromEnv) return fromEnv;
  const stored = storedVapid();
  if (stored) return stored;
  const fresh = wp.generateVAPIDKeys();
  const keys = { publicKey: fresh.publicKey, privateKey: fresh.privateKey, subject: 'mailto:ops@sbynhamhub.com' };
  saveVapid(keys);
  return keys;
}

function allSubscriptions() {
  return db.prepare('SELECT * FROM push_subscriptions ORDER BY id ASC').all();
}

function addSubscription({ endpoint = '', keys = {}, email = '', phone = '' }) {
  if (!endpoint) return null;
  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
  if (existing) {
    db.prepare('UPDATE push_subscriptions SET keys = ?, email = ?, phone = ? WHERE id = ?').run(
      JSON.stringify(keys || {}), String(email || '').trim(), String(phone || '').trim(), existing.id
    );
    return existing.id;
  }
  return Number(db.prepare(
    'INSERT INTO push_subscriptions (endpoint, keys, email, phone) VALUES (?, ?, ?, ?)'
  ).run(endpoint, JSON.stringify(keys || {}), String(email || '').trim(), String(phone || '').trim()).lastInsertRowid);
}

function removeSubscription(id) {
  db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
}

async function sendPush(subscription, payload, { prune = true } = {}) {
  const wp = loadWebPush();
  const vapid = getVapid();
  if (!wp || !vapid) return { sent: false, dev: true, reason: 'web-push-unavailable' };
  let sub;
  try {
    sub = { endpoint: subscription.endpoint, keys: JSON.parse(subscription.keys || '{}') };
  } catch {
    return { sent: false, dev: false, reason: 'bad-subscription' };
  }
  try {
    await wp.sendNotification(sub, JSON.stringify(payload), { vapidDetails: vapid });
    return { sent: true };
  } catch (error) {
    const gone = [404, 410].includes(Number(error?.statusCode));
    if (gone && prune) removeSubscription(subscription.id);
    return { sent: false, dev: false, reason: gone ? 'subscription-gone' : String(error?.message || error) };
  }
}

async function sendPushToMatches({ email = '', phone = '' }, payload) {
  const targets = allSubscriptions().filter(
    (s) => (email && String(s.email).trim().toLowerCase() === String(email).trim().toLowerCase()) ||
           (phone && String(s.phone).trim() === String(phone).trim())
  );
  const results = [];
  for (const target of targets) {
    results.push({ id: target.id, ...(await sendPush(target, payload)) });
  }
  return results;
}

function pushSupported() {
  return !!loadWebPush();
}

module.exports = {
  pushSupported,
  getVapid,
  allSubscriptions,
  addSubscription,
  removeSubscription,
  sendPush,
  sendPushToMatches
};

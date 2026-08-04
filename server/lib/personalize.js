'use strict';

const { guestId } = require('../format');
const { publicItem } = require('../format');

const PERSONALISED_AFTER = 5;

const SIGNAL_STATUSES = ['confirmed', 'arrived', 'completed'];

function reservationsForGuest(db, guestKey) {
  const rows = db.prepare('SELECT * FROM reservations').all();
  return rows.filter((r) => guestId(r.email, r.phone) === guestKey && SIGNAL_STATUSES.includes(r.status));
}

function reviewsForGuest(db, guestKey) {
  const rows = db.prepare('SELECT * FROM reviews').all();
  return rows.filter((r) => guestId(r.email, r.phone) === guestKey);
}

function savesForGuest(db, guestKey) {
  return db.prepare('SELECT * FROM saves WHERE guest_key = ? ORDER BY id DESC').all(guestKey);
}

function correctionsForGuest(db, guestKey) {
  return db.prepare('SELECT * FROM pref_corrections WHERE guest_key = ?').all(guestKey);
}

function categoryAffinity(db, guestKey) {
  const affinity = {};
  const bump = (categoryId, amount) => {
    if (!categoryId) return;
    affinity[categoryId] = (affinity[categoryId] || 0) + amount;
  };
  for (const save of savesForGuest(db, guestKey)) {
    const item = db.prepare('SELECT category_id FROM menu_items WHERE id = ?').get(save.item_id);
    bump(item?.category_id, 3);
  }
  for (const correction of correctionsForGuest(db, guestKey)) {
    const item = db.prepare('SELECT category_id FROM menu_items WHERE id = ?').get(correction.item_id);
    bump(item?.category_id, correction.signal > 0 ? 2 : -2);
  }
  return affinity;
}

function readiness(db, guestKey) {
  const bookings = reservationsForGuest(db, guestKey).length;
  const reviews = reviewsForGuest(db, guestKey).length;
  const signals = bookings + reviews;
  return {
    bookings,
    reviews,
    signals,
    personalised: signals >= PERSONALISED_AFTER,
    progress: Math.min(100, Math.round((signals / PERSONALISED_AFTER) * 100)),
    to_go: Math.max(0, PERSONALISED_AFTER - signals)
  };
}

function savedIds(db, guestKey) {
  return savesForGuest(db, guestKey).map((s) => Number(s.item_id));
}

function personalisedFeed(db, guestKey, { limit = 6 } = {}) {
  const affinity = categoryAffinity(db, guestKey);
  const corrections = new Map(correctionsForGuest(db, guestKey).map((c) => [Number(c.item_id), Number(c.signal)]));
  const saved = new Set(savedIds(db, guestKey));
  const state = readiness(db, guestKey);

  const items = db
    .prepare(
      `SELECT m.*, c.name AS category, c.slug AS category_slug
       FROM menu_items m JOIN categories c ON c.id = m.category_id
       WHERE m.available != 0`
    )
    .all();

  const scored = items
    .map((item) => {
      let score = 0;
      if (saved.has(item.id)) score += 2;
      if (Number(item.featured)) score += 1;
      score += (affinity[item.category_id] || 0) * 1.5;
      const correction = corrections.get(item.id);
      if (correction) score += correction * 3;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  const top = scored.slice(0, limit).map(({ item }) => publicItem(item));
  return { state, top };
}

function profile(db, guestKey) {
  const state = readiness(db, guestKey);
  const affinity = categoryAffinity(db, guestKey);
  const savedIdsList = savedIds(db, guestKey);
  const categories = db.prepare('SELECT id, name, slug FROM categories ORDER BY sort ASC').all();
  const topCategories = categories
    .map((c) => ({ ...c, score: affinity[c.id] || 0 }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const savedItems = db
    .prepare(
      `SELECT m.*, c.name AS category, c.slug AS category_slug
       FROM menu_items m JOIN categories c ON c.id = m.category_id
       WHERE m.id IN (SELECT item_id FROM saves WHERE guest_key = ?)`
    )
    .all(guestKey)
    .map(publicItem);

  return {
    state,
    categories: topCategories,
    saved: savedItems,
    corrections: correctionsForGuest(db, guestKey).length
  };
}

function recordSave(db, guestKey, itemId) {
  const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(Number(itemId));
  if (!item) return { error: 'Dish not found' };
  db.prepare('INSERT OR IGNORE INTO saves (guest_key, item_id) VALUES (?, ?)').run(guestKey, Number(itemId));
  return { ok: true };
}

function removeSave(db, guestKey, itemId) {
  db.prepare('DELETE FROM saves WHERE guest_key = ? AND item_id = ?').run(guestKey, Number(itemId));
  return { ok: true };
}

function recordCorrection(db, guestKey, itemId, signal) {
  const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(Number(itemId));
  if (!item) return { error: 'Dish not found' };
  const value = signal > 0 ? 1 : -1;
  db.prepare(
    `INSERT INTO pref_corrections (guest_key, item_id, signal) VALUES (?, ?, ?)
     ON CONFLICT(guest_key, item_id) DO UPDATE SET signal = excluded.signal`
  ).run(guestKey, Number(itemId), value);
  return { ok: true };
}

function resetGuest(db, guestKey) {
  db.prepare('DELETE FROM saves WHERE guest_key = ?').run(guestKey);
  db.prepare('DELETE FROM pref_corrections WHERE guest_key = ?').run(guestKey);
  db.prepare('DELETE FROM guest_profiles WHERE guest_key = ?').run(guestKey);
  return { ok: true };
}

module.exports = {
  PERSONALISED_AFTER,
  readiness,
  personalisedFeed,
  profile,
  recordSave,
  removeSave,
  recordCorrection,
  resetGuest,
  savesForGuest,
  correctionsForGuest
};

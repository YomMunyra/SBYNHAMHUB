'use strict';

const POINTS_EXPIRY_MONTHS = 18;
const POINTS_EXPIRY_SOON_DAYS = 30;

function computeBalance(db, key) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(remaining), 0) AS n FROM points_ledger
       WHERE guest_key = ? AND reason = 'earned' AND expires_at > datetime('now')`
    )
    .get(key);
  return Number(row.n);
}

function expiringSoon(db, key) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(remaining), 0) AS n FROM points_ledger
       WHERE guest_key = ? AND reason = 'earned'
         AND expires_at > datetime('now')
         AND expires_at <= datetime('now', '+30 days')`
    )
    .get(key);
  return Number(row.n);
}

function earliestExpiry(db, key) {
  const row = db
    .prepare(
      `SELECT MIN(expires_at) AS at FROM points_ledger
       WHERE guest_key = ? AND reason = 'earned' AND remaining > 0 AND expires_at > datetime('now')`
    )
    .get(key);
  return row.at || null;
}

function redeemPoints(db, key, amount, refId, note) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let left = Number(amount);
  const batches = db
    .prepare(
      `SELECT id, remaining FROM points_ledger
       WHERE guest_key = ? AND reason = 'earned' AND remaining > 0 AND expires_at > ?
       ORDER BY id ASC`
    )
    .all(key, now);
  const update = db.prepare('UPDATE points_ledger SET remaining = remaining - ? WHERE id = ?');
  for (const batch of batches) {
    if (left <= 0) break;
    const take = Math.min(Number(batch.remaining), left);
    update.run(take, batch.id);
    left -= take;
  }
  if (left > 0) throw new Error('Not enough points');
  db.prepare(
    `INSERT INTO points_ledger (guest_key, delta, reason, ref_id, note) VALUES (?, ?, 'redeemed', ?, ?)`
  ).run(key, -Number(amount), String(refId), String(note));
}

function syncBalance(db, key) {
  const balance = computeBalance(db, key);
  db.prepare('UPDATE points_accounts SET balance = ? WHERE guest_key = ?').run(balance, key);
  return balance;
}

module.exports = {
  POINTS_EXPIRY_MONTHS,
  POINTS_EXPIRY_SOON_DAYS,
  computeBalance,
  expiringSoon,
  earliestExpiry,
  redeemPoints,
  syncBalance
};

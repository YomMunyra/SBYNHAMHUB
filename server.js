'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sbynham2026';
const TOKENS = new Set();

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function publicItem(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    image: row.image,
    tag: row.tag,
    featured: !!row.featured,
    category: row.category,
    category_slug: row.category_slug
  };
}

const VALID_STATUS = ['pending', 'confirmed', 'arrived', 'cancelled', 'no-show'];
const VALID_OCCASIONS = ['', 'Birthday', 'Anniversary', 'Date Night', 'Business', 'Family Gathering', 'Other'];
const VALID_TABLES = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);

function auth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!TOKENS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/* ---------------- Menu ---------------- */

app.get('/api/categories', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, slug FROM categories ORDER BY sort ASC')
    .all();
  res.json(rows);
});

app.get('/api/menu', (req, res) => {
  const { category, featured } = req.query;
  let sql = `
    SELECT m.*, c.name AS category, c.slug AS category_slug
    FROM menu_items m
    JOIN categories c ON c.id = m.category_id
  `;
  const where = [];
  const params = [];
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (featured === '1') {
    where.push('m.featured = 1');
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY c.sort ASC, m.name ASC';
  const rows = db.prepare(sql).all(...params).map(publicItem);
  res.json(rows);
});

/* ---------------- Reservations ---------------- */

app.get('/api/reservations', auth, (req, res) => {
  const { date } = req.query;
  let sql = 'SELECT * FROM reservations';
  const params = [];
  if (date) {
    sql += ' WHERE date = ?';
    params.push(date);
  }
  sql += ' ORDER BY date ASC, time ASC, id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/reservations', (req, res) => {
  const {
    name = '',
    email = '',
    phone = '',
    date = '',
    time = '',
    guests = '',
    occasion = '',
    notes = ''
  } = req.body;

  const errs = [];
  if (!String(name).trim()) errs.push('name');
  if (!String(phone).trim()) errs.push('phone');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) errs.push('date');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) errs.push('time');
  const n = Number(guests);
  if (!Number.isInteger(n) || n < 1 || n > 20) errs.push('guests');
  if (occasion && !VALID_OCCASIONS.includes(String(occasion))) errs.push('occasion');

  if (errs.length) {
    return res.status(400).json({ error: 'Invalid fields: ' + errs.join(', ') });
  }

  const past = date + ' ' + time + ':00';
  if (new Date(past + 'Z').getTime() <= Date.now() - 15 * 60 * 1000) {
    return res.status(400).json({ error: 'Please pick a future date and time.' });
  }

  const result = db
    .prepare(
      `INSERT INTO reservations (name, email, phone, date, time, guests, occasion, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(email).trim(),
      String(phone).trim(),
      date,
      time,
      n,
      occasion || '',
      String(notes || '').trim()
    );

  const row = db
    .prepare('SELECT * FROM reservations WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json({ ok: true, reservation: row });
});

app.patch('/api/reservations/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const { status, table } = req.body;
  if (status !== undefined && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (table !== undefined && table !== '' && !VALID_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' });
  const result = db.prepare('UPDATE reservations SET status = COALESCE(?, status), table_name = COALESCE(?, table_name) WHERE id = ?').run(status ?? null, table ?? null, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Reservation not found' });
  }
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  res.json({ ok: true, reservation: row });
});

app.delete('/api/reservations/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Reservation not found' });
  }
  res.json({ ok: true });
});

app.get('/api/stats', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const all = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
  const todayCount = db
    .prepare('SELECT COUNT(*) AS n FROM reservations WHERE date = ?')
    .get(today).n;
  const covers = db
    .prepare('SELECT COALESCE(SUM(guests), 0) AS n FROM reservations WHERE date = ?')
    .get(today).n;
  const confirmed = db
    .prepare("SELECT COUNT(*) AS n FROM reservations WHERE status = 'confirmed'")
    .get().n;
  const byStatus = db
    .prepare('SELECT status, COUNT(*) AS n FROM reservations GROUP BY status')
    .all();
  res.json({ total: all, today: todayCount, covers_today: covers, confirmed, by_status: byStatus });
});

/* ---------------- Reviews ---------------- */

function reviewOverall(row) {
  return Math.round((row.rating_food + row.rating_service + row.rating_ambience + row.rating_value) / 4);
}

function publicReview(row) {
  const parts = String(row.name || '').trim().split(/\s+/);
  const firstName = parts[0] || 'Guest';
  const lastInitial = parts.length > 1 ? ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.' : '';
  return {
    id: row.id,
    name: firstName + lastInitial,
    overall: reviewOverall(row),
    ratings: { food: row.rating_food, service: row.rating_service, ambience: row.rating_ambience, value: row.rating_value },
    comment: row.comment,
    reply: row.reply || '',
    created_at: row.created_at
  };
}

app.get('/api/reviews/summary', (req, res) => {
  const rows = db.prepare("SELECT * FROM reviews WHERE status = 'published'").all();
  const count = rows.length;
  const avg = count ? rows.reduce((sum, row) => sum + reviewOverall(row), 0) / count : 0;
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const row of rows) distribution[reviewOverall(row)] += 1;
  res.json({ count, avg: Math.round(avg * 10) / 10, distribution });
});

app.get('/api/reviews', (req, res) => {
  if (req.query.all === '1') {
    return auth(req, res, () => {
      const rows = db.prepare('SELECT * FROM reviews ORDER BY id DESC').all();
      res.json(rows);
    });
  }
  const rows = db.prepare("SELECT * FROM reviews WHERE status = 'published' ORDER BY id DESC").all();
  res.json(rows.map(publicReview));
});

app.post('/api/reviews', (req, res) => {
  const {
    reservation_id = '',
    contact = '',
    food = '',
    service = '',
    ambience = '',
    value = '',
    comment = ''
  } = req.body;

  const errs = [];
  const rid = Number(reservation_id);
  if (!Number.isInteger(rid) || rid <= 0) errs.push('reservation_id');
  if (!String(contact).trim()) errs.push('contact');
  const ratings = [food, service, ambience, value].map(Number);
  for (const r of ratings) {
    if (!Number.isInteger(r) || r < 1 || r > 5) errs.push('rating');
  }
  if (!String(comment).trim()) errs.push('comment');
  if (String(comment).trim().length > 2000) errs.push('comment length');
  if (errs.length) {
    return res.status(400).json({ error: 'Invalid fields: ' + errs.join(', ') });
  }

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid);
  if (!reservation) {
    return res.status(404).json({ error: 'No booking found with that reference.' });
  }

  const now = new Date();
  const bookingDate = new Date(reservation.date + 'T' + reservation.time + ':00');
  if (bookingDate.getTime() >= now.getTime()) {
    return res.status(400).json({ error: 'Reviews are only possible after your visit.' });
  }
  if (!['arrived', 'confirmed', 'completed'].includes(reservation.status)) {
    return res.status(400).json({ error: 'Only completed visits can be reviewed.' });
  }

  const c = String(contact).trim().toLowerCase();
  const email = String(reservation.email || '').trim().toLowerCase();
  const phone = String(reservation.phone || '').trim();
  if (c !== email && c !== phone) {
    return res.status(403).json({ error: 'That contact does not match the booking.' });
  }

  const existing = db.prepare('SELECT id FROM reviews WHERE reservation_id = ?').get(rid);
  if (existing) {
    return res.status(409).json({ error: 'A review already exists for this booking.' });
  }

  const result = db
    .prepare(
      `INSERT INTO reviews (reservation_id, name, email, phone, rating_food, rating_service, rating_ambience, rating_value, comment, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      rid,
      String(reservation.name).trim(),
      String(reservation.email || '').trim(),
      String(reservation.phone || '').trim(),
      ratings[0],
      ratings[1],
      ratings[2],
      ratings[3],
      String(comment).trim()
    );

  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ok: true, review: publicReview(row) });
});

app.patch('/api/reviews/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const { status, reply } = req.body;
  if (status !== undefined && !['pending', 'published', 'hidden'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (reply !== undefined && String(reply).length > 1000) {
    return res.status(400).json({ error: 'Reply is too long' });
  }
  const result = db
    .prepare('UPDATE reviews SET status = COALESCE(?, status), reply = COALESCE(?, reply) WHERE id = ?')
    .run(status ?? null, reply ?? null, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Review not found' });
  }
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  res.json({ ok: true, review: row });
});

/* ---------------- Admin auth ---------------- */

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    TOKENS.add(token);
    return res.json({ ok: true, token });
  }
  res.status(401).json({ error: 'Invalid password' });
});

/* ---------------- Pages ---------------- */

app.get(['/menu', '/book', '/reviews'], (req, res) => res.sendFile(path.join(__dirname, 'public', req.path.slice(1) + '.html')));
app.get('/manager', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'platform-admin.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SbyNhamHub running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
